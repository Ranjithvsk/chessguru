import { Link } from "react-router-dom";
export default function Footer() {
  return (
    <footer className="border-t border-[color:var(--border)] mt-10">
      <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-xs opacity-70">
        <div className="flex items-center gap-2 font-semibold">
          <span style={{ color: "#fbbf24" }}>♟</span>
          <span>ChessGuru Play</span>
          <span className="opacity-50">· Every India tournament, one home</span>
        </div>
        <div className="flex gap-5">
          <Link to="/submit-tournament" className="hover:opacity-100">List a tournament</Link>
          <a href="https://chessguru.cc/" className="hover:opacity-100">ChessGuru</a>
          <a href="https://chessguru.cc/signup-academy" className="hover:opacity-100">Academies</a>
          <a href="mailto:hello@chessguru.cc" className="hover:opacity-100">Contact</a>
        </div>
      </div>
    </footer>
  );
}
