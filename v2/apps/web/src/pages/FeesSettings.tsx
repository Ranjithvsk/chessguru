// Fees → Settings (W4e)
//
// Owner-facing per-tenant config: Razorpay keys, business identity (GSTIN /
// PAN / legal name), receipt prefix, bank last-4. All fields optional. Save
// is a PATCH so partial edits work — leave a field blank to keep it, type
// null-clear via the "Clear" button next to each.
//
// Security note: secrets never come back from the server (only *Set booleans).
// Owner "replaces" a secret by typing a new one; "clears" via the small
// destructive button. Actual values live in fees_settings in plaintext —
// same trust boundary as .env, hardened in world-class §Security later.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { feesApi, type FeeSettingsResponse, type UpdateFeeSettingsInput } from "../lib/fees-api";

const t = (s: string) => s;

export default function FeesSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["fees.settings"],
    queryFn: () => feesApi.getSettings(),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Link to="/fees" className="text-ink-300 hover:text-white">← {t("Fees")}</Link>
        <span className="text-ink-500">/</span>
        <span className="text-ink-300">{t("Settings")}</span>
      </div>
      <header className="mb-6">
        <div className="mb-1">
          <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-300 ring-1 ring-brand-400/30">{t("Beta · W4")}</span>
        </div>
        <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">{t("Fees settings")}</h1>
        <p className="mt-1 max-w-lg text-sm text-ink-300">{t("Payment gateway, GSTIN, and receipt configuration for this academy.")}</p>
      </header>

      {isLoading && <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-8 text-center text-sm text-ink-400">{t("Loading…")}</div>}
      {isError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <div className="mb-2 text-3xl">😬</div>
          <div className="text-sm text-ink-200">{error instanceof Error ? error.message : t("Couldn't load settings.")}</div>
          <button onClick={() => refetch()} className="mt-3 h-10 rounded-xl border border-red-500/50 bg-red-500/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-500/20">{t("Retry")}</button>
        </div>
      )}

      {data && <SettingsForm data={data} onSaved={() => qc.invalidateQueries({ queryKey: ["fees.settings"] })} />}
    </div>
  );
}

function SettingsForm({ data, onSaved }: { data: FeeSettingsResponse; onSaved: () => void }) {
  const [rzpKeyId, setRzpKeyId] = useState(data.razorpayKeyId ?? "");
  const [rzpKeySecret, setRzpKeySecret] = useState("");
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState("");
  const [gstin, setGstin] = useState(data.gstin ?? "");
  const [legalName, setLegalName] = useState(data.legalName ?? "");
  const [panNo, setPanNo] = useState(data.panNo ?? "");
  const [receiptPrefix, setReceiptPrefix] = useState(data.receiptPrefix ?? "");
  const [bankLast4, setBankLast4] = useState(data.bankAccountLast4 ?? "");
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // If the server data changes (e.g. after a save invalidates the query),
  // rehydrate the non-secret fields. Secrets are always blank in state.
  useEffect(() => {
    setRzpKeyId(data.razorpayKeyId ?? "");
    setGstin(data.gstin ?? "");
    setLegalName(data.legalName ?? "");
    setPanNo(data.panNo ?? "");
    setReceiptPrefix(data.receiptPrefix ?? "");
    setBankLast4(data.bankAccountLast4 ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: UpdateFeeSettingsInput) => feesApi.updateSettings(patch),
    onSuccess: (r) => {
      setErr(null);
      setRzpKeySecret(""); setRzpWebhookSecret("");
      setToast(t("Saved."));
      setTimeout(() => setToast(null), 2000);
      onSaved();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't save.")),
  });

  function submit() {
    // Build patch: send only the fields that changed. Empty string ≠ null
    // — empty = "no change / keep whatever the server has" for secrets, and
    // "set to empty" for non-secrets. Use the explicit "Clear" buttons for
    // deliberate nulls.
    const patch: UpdateFeeSettingsInput = {};
    if (rzpKeyId !== (data.razorpayKeyId ?? "")) patch.razorpayKeyId = rzpKeyId || null;
    if (rzpKeySecret.trim()) patch.razorpayKeySecret = rzpKeySecret.trim();
    if (rzpWebhookSecret.trim()) patch.razorpayWebhookSecret = rzpWebhookSecret.trim();
    if (gstin.trim().toUpperCase() !== (data.gstin ?? "")) patch.gstin = gstin.trim() ? gstin.trim().toUpperCase() : null;
    if (legalName !== (data.legalName ?? "")) patch.legalName = legalName || null;
    if (panNo.trim().toUpperCase() !== (data.panNo ?? "")) patch.panNo = panNo.trim() ? panNo.trim().toUpperCase() : null;
    if (receiptPrefix.trim().toUpperCase() !== (data.receiptPrefix ?? "")) patch.receiptPrefix = receiptPrefix.trim() ? receiptPrefix.trim().toUpperCase() : null;
    if (bankLast4 !== (data.bankAccountLast4 ?? "")) patch.bankAccountLast4 = bankLast4 || null;
    if (Object.keys(patch).length === 0) { setToast(t("Nothing to save.")); setTimeout(() => setToast(null), 1200); return; }
    save.mutate(patch);
  }

  function clearField(key: keyof UpdateFeeSettingsInput) {
    save.mutate({ [key]: null } as UpdateFeeSettingsInput);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Payments */}
      <Section title={t("Payments")} icon="💳" subtitle={t("Razorpay credentials for the parent portal. Test keys start rzp_test_; live keys rzp_live_.")}>
        <Field label={t("Razorpay Key ID")}>
          <input value={rzpKeyId} onChange={(e) => setRzpKeyId(e.target.value)} placeholder="rzp_test_xxxxxxxxxxxxxx" className="input" />
        </Field>
        <Field label={t("Razorpay Key Secret")} muted={t(data.razorpayKeySecretSet ? "Currently: •••••• (leave blank to keep, type new to replace)" : "Currently: not set")}>
          <div className="flex gap-2">
            <input value={rzpKeySecret} onChange={(e) => setRzpKeySecret(e.target.value)} type="password" placeholder={data.razorpayKeySecretSet ? "••••••" : "Enter secret"} className="input flex-1" />
            {data.razorpayKeySecretSet && <ClearButton onClick={() => clearField("razorpayKeySecret")} />}
          </div>
        </Field>
        <Field label={t("Razorpay Webhook Secret")} muted={t(data.razorpayWebhookSecretSet ? "Currently: •••••• (leave blank to keep, type new to replace)" : "Currently: not set")}>
          <div className="flex gap-2">
            <input value={rzpWebhookSecret} onChange={(e) => setRzpWebhookSecret(e.target.value)} type="password" placeholder={data.razorpayWebhookSecretSet ? "••••••" : "Enter webhook secret"} className="input flex-1" />
            {data.razorpayWebhookSecretSet && <ClearButton onClick={() => clearField("razorpayWebhookSecret")} />}
          </div>
        </Field>

        <div className="mt-2 rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 text-[12px] text-brand-100">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{t("Configure in your Razorpay dashboard")}</div>
          <div className="text-ink-300">{t("Add this URL under Settings → Webhooks, subscribe to")} <code className="rounded bg-ink-800 px-1 py-0.5">payment.captured</code>:</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-950 px-3 py-2 text-[11px] text-ink-100">{data.webhookUrl}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(data.webhookUrl).then(() => { setToast(t("Copied!")); setTimeout(() => setToast(null), 1500); }); }}
              className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-xs text-ink-200 hover:bg-ink-700"
            >{t("Copy")}</button>
          </div>
        </div>
      </Section>

      {/* Business */}
      <Section title={t("Business identity")} icon="📇" subtitle={t("For invoices and receipts. Only fill if you're registered — the fields are optional.")}>
        <Field label={t("Legal name")}>
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Guna Chess Academy Pvt Ltd" className="input" />
        </Field>
        <Field label={t("GSTIN")} muted={t("15 characters — leave blank if unregistered.")}>
          <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" maxLength={15} className="input font-mono" />
        </Field>
        <Field label={t("PAN")}>
          <input value={panNo} onChange={(e) => setPanNo(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} className="input font-mono" />
        </Field>
      </Section>

      {/* Receipts */}
      <Section title={t("Receipts")} icon="🧾" subtitle={t("How your invoice + receipt numbers look. Defaults to your academy slug.")}>
        <Field label={t("Receipt prefix")} muted={t("2–12 uppercase letters/digits. Invoices become PREFIX/2026-27/000001.")}>
          <input value={receiptPrefix} onChange={(e) => setReceiptPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="GUNA" maxLength={12} className="input font-mono" />
        </Field>
        <Field label={t("Bank account last 4")} muted={t("Shown on receipts so parents recognise which account they paid.")}>
          <input value={bankLast4} onChange={(e) => setBankLast4(e.target.value.replace(/\D+/g, "").slice(0, 4))} placeholder="1234" maxLength={4} className="input font-mono w-24" />
        </Field>
      </Section>

      {err && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>}

      <div className="sticky bottom-4 flex items-center justify-end gap-2">
        {toast && <div role="status" className="rounded-xl border border-accent-500/40 bg-ink-950 px-3 py-2 text-sm text-accent-200 shadow-2xl">{toast}</div>}
        <button
          onClick={submit}
          disabled={save.isPending}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
        >
          {save.isPending ? t("Saving…") : t("Save settings")}
        </button>
      </div>

      <style>{`
        .input { height: 2.75rem; width: 100%; box-sizing: border-box; padding: 0 1rem; border-radius: 0.75rem; border: 1px solid rgb(31 41 55); background: rgb(11 15 25); color: rgb(241 245 249); font-size: 0.875rem; }
        .input:focus { outline: none; border-color: rgb(99 102 241); box-shadow: 0 0 0 3px rgb(99 102 241 / 0.3); }
        .input::placeholder { color: rgb(75 85 99); }
      `}</style>
    </div>
  );
}

function Section({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
      <div className="mb-3 flex items-baseline gap-2">
        <span aria-hidden className="text-lg">{icon}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">{title}</h2>
      </div>
      <p className="mb-4 text-[12px] text-ink-400">{subtitle}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, muted, children }: { label: string; muted?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{label}</span>
      {children}
      {muted && <span className="mt-1 block text-[11px] text-ink-500">{muted}</span>}
    </label>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => { if (confirm("Clear this secret? Online payment will stop working until you set it again.")) onClick(); }}
      className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/20"
      title="Clear"
    >
      Clear
    </button>
  );
}
