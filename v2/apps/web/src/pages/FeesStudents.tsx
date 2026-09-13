// /fees/students — TKT-224: the full student roster with guardian WhatsApp
// numbers and fee status. Same table as the /fees landing, on its own page.
import { Link } from "react-router-dom";
import FeesStudentsTable from "../components/FeesStudentsTable";

const t = (s: string) => s;

export default function FeesStudentsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Link to="/fees" className="text-ink-300 hover:text-white">← {t("Fees")}</Link>
        <span className="text-ink-500">/</span>
        <span className="text-ink-300">{t("Students")}</span>
      </div>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">👦 {t("Students")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t("Everyone in the academy, with the parent's WhatsApp number, batch, fee programme and dues. Fix the “No WhatsApp” rows first — that's where reminders go.")}</p>
      </header>
      <FeesStudentsTable compact />
    </div>
  );
}
