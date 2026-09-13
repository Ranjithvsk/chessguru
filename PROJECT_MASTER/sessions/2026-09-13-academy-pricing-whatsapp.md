# 2026-09-13 — Academy pricing tiers + WhatsApp on /signup-academy

Owner: "50 students 1000 per month, 100 students 1500 per month, 500 per month for additional 50 students, unlimited coaches, more than 500 students → quotations. Also add my WhatsApp number 8248353593 with icon in academy sign-up page."

`v2/apps/web/src/pages/SignupAcademy.tsx`
- `PRICING` tiers: Starter ₹1,000/mo (≤50 students) · Academy ₹1,500/mo (≤100, highlighted; +₹500 per extra 50) · Large academy (500+) = quotation via WhatsApp. `priceFor(n)` drives the growth ladder chips (150 → ₹2,000 … 500 → ₹5,500). Coaches unlimited everywhere; 30-day free trial unchanged.
- WhatsApp: `WHATSAPP_NUMBER = 918248353593` — floating green "WhatsApp us" button (bottom-right), "Ask for a quotation" on the 500+ card, pricing footnote link, footer link. All `wa.me` links carry a prefilled message.
- FAQ and hero pill updated ("from ₹1,000/month after"); "One price" heading → "Every plan".
Nothing server-side changed; billing is still manual.
