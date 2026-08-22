// Small form controls used by the submit form. Kept inline-styled here so they
// stay consistent even if Tailwind purge is aggressive on strings.
import React from "react";

export function Input({ label, help, required, error, ...rest }: any) {
  return (
    <label className="block">
      <span className="text-xs font-semibold opacity-80 mb-1.5 block">
        {label}{required && <span style={{ color: "#f472b6" }}> *</span>}
      </span>
      <input
        {...rest}
        className={`w-full rounded-xl border bg-[color:var(--input-bg)] px-4 py-2.5 text-sm text-white placeholder:text-[color:var(--text-muted)] focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 ${error ? "border-rose-400/60" : "border-[color:var(--border-strong)]"}`}
      />
      {help && <span className="text-[11px] opacity-60 mt-1 block">{help}</span>}
    </label>
  );
}

export function Select({ label, required, options, ...rest }: any) {
  return (
    <label className="block">
      <span className="text-xs font-semibold opacity-80 mb-1.5 block">
        {label}{required && <span style={{ color: "#f472b6" }}> *</span>}
      </span>
      <select {...rest} className="w-full rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--input-bg)] px-4 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30">
        {options.map((o: any) => (
          <option key={o.value ?? o} value={o.value ?? o} style={{ color: "#000" }}>{o.label ?? o}</option>
        ))}
      </select>
    </label>
  );
}

export function Chip({ label, active, onClick, type = "button" }: any) {
  return (
    <button
      type={type} onClick={onClick}
      className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition ${active ? "text-black border-transparent" : "text-[color:var(--text-dim)] border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]"}`}
      style={active ? { background: "linear-gradient(135deg,#fbbf24,#f472b6)" } : {}}
    >{label}</button>
  );
}
