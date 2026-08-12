"""Train MobileNetV3-small chess-board corner regression on Vinayaka GPU.

Input: 384x384 RGB image (JPEG loaded via PIL).
Output: 8 floats — 4 corners × (x, y), normalized to [0, 1] against
image size (so it's resolution-independent).

Architecture: mobilenetv3_small_100 ImageNet-pretrained + 8-dim
regression head. All params trainable (small model, 30K training
samples is plenty).

Loss: smooth-L1 (Huber) on the 8-dim vector -- robust to occasional
label noise from perspective math edge cases.

Metric: mean corner error in pixels (converted from normalized).
Target: < 5 px average corner error on val split (indistinguishable
from perfect for a 384x384 image where 1 board cell is ~48px).

Run: cd C:\chess-vision
     python -u train-corner.py --data corner-train-v2 --epochs 20 --batch 128
"""
import argparse, time, json, os
from pathlib import Path
import torch, timm
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image

IMG = 384

class CornerDataset(Dataset):
    def __init__(self, root: Path, tfm):
        self.root = root
        self.tfm = tfm
        recs = []
        for line in open(root / "labels.jsonl"):
            recs.append(json.loads(line))
        self.recs = recs

    def __len__(self):
        return len(self.recs)

    def __getitem__(self, idx):
        rec = self.recs[idx]
        img = Image.open(self.root / "images" / rec["image"]).convert("RGB")
        # Assume dataset is already at IMG size; if not, resize.
        if img.size != (IMG, IMG):
            img = img.resize((IMG, IMG), Image.LANCZOS)
        # Corners are in absolute px; normalize to [0, 1].
        size = rec.get("size", IMG)
        corners = rec["corners"]
        y = torch.tensor(
            [c / size for pt in corners for c in pt],
            dtype=torch.float32,
        )
        return self.tfm(img), y

def build_model():
    m = timm.create_model("mobilenetv3_small_100.lamb_in1k", pretrained=True, num_classes=8)
    return m

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="corner-train-v2")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--wd", type=float, default=1e-4)
    ap.add_argument("--workers", type=int, default=0)
    ap.add_argument("--out", default=".")
    args = ap.parse_args()

    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[env] torch={torch.__version__} device={dev}")

    mean = [0.485, 0.456, 0.406]; std = [0.229, 0.224, 0.225]
    tfm = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mean, std),
    ])
    train_ds = CornerDataset(Path(args.data) / "train", tfm)
    val_ds   = CornerDataset(Path(args.data) / "val",   tfm)
    print(f"[data] train={len(train_ds)} val={len(val_ds)}")

    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True,  num_workers=args.workers, pin_memory=True)
    val_dl   = DataLoader(val_ds,   batch_size=args.batch, shuffle=False, num_workers=args.workers, pin_memory=True)

    model = build_model().to(dev)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"[model] mobilenetv3_small_100 params={n_params/1e6:.2f}M")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    loss_fn = nn.SmoothL1Loss()

    best_err = 1e9
    log = []
    for epoch in range(1, args.epochs+1):
        model.train()
        t0 = time.time()
        n=0; loss_sum=0.0; err_sum=0.0
        for x, y in train_dl:
            x=x.to(dev, non_blocking=True); y=y.to(dev, non_blocking=True)
            pred = model(x)
            loss = loss_fn(pred, y)
            opt.zero_grad(); loss.backward(); opt.step()
            loss_sum += loss.item() * x.size(0)
            # Corner error in normalized units; convert to px
            with torch.no_grad():
                diffs = (pred - y).view(x.size(0), 4, 2)
                per_corner_dist = torch.norm(diffs, dim=2)  # (B, 4)
                err_sum += per_corner_dist.mean(dim=1).sum().item()
            n += x.size(0)
        train_loss = loss_sum / n; train_err_norm = err_sum / n; train_err_px = train_err_norm * IMG
        model.eval()
        n=0; err_sum=0.0
        with torch.no_grad():
            for x, y in val_dl:
                x=x.to(dev, non_blocking=True); y=y.to(dev, non_blocking=True)
                pred = model(x)
                diffs = (pred - y).view(x.size(0), 4, 2)
                per_corner_dist = torch.norm(diffs, dim=2)
                err_sum += per_corner_dist.mean(dim=1).sum().item()
                n += x.size(0)
        val_err_norm = err_sum / n; val_err_px = val_err_norm * IMG
        sched.step()
        dt = time.time()-t0
        log.append({"epoch": epoch, "train_loss": train_loss, "train_err_px": train_err_px, "val_err_px": val_err_px, "dt": dt})
        print(f"[e{epoch:02d}] loss={train_loss:.5f} train_err={train_err_px:.2f}px val_err={val_err_px:.2f}px ({dt:.1f}s)")
        if val_err_px < best_err:
            best_err = val_err_px
            torch.save({"model": model.state_dict(), "arch": "mobilenetv3_small_100", "img_size": IMG}, Path(args.out) / "best-corner.pt")
            print(f"       -> saved best-corner.pt (val {val_err_px:.2f}px)")

    with open(Path(args.out) / "train-corner-log.json", "w") as f:
        json.dump({"log": log, "best_val_px": best_err}, f, indent=2)
    print(f"\n[done] best val_err_px={best_err:.2f}")

if __name__ == "__main__":
    main()
