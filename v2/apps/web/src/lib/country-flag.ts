// Team name -> flag emoji.
//
// A broadcast gives a nationality in exactly one place: WhiteTeam/BlackTeam on
// a TEAM event, spelled as a country name ("Timor-Leste", "Cambodia"). There
// is no country tag on an individual tournament, and FIDE's own player list —
// which is what Lichess maps FIDE ids against — is unreachable from this host.
// So flags appear on team events, and nowhere we would have to guess.
//
// Mapping name -> ISO2 -> regional-indicator pair. Unknown names simply get no
// flag rather than a wrong one.
const ISO2: Record<string, string> = {
  afghanistan: "AF", albania: "AL", algeria: "DZ", andorra: "AD", angola: "AO", argentina: "AR",
  armenia: "AM", australia: "AU", austria: "AT", azerbaijan: "AZ", bahrain: "BH", bangladesh: "BD",
  belarus: "BY", belgium: "BE", bolivia: "BO", bosnia: "BA", "bosnia & herzegovina": "BA",
  "bosnia and herzegovina": "BA", botswana: "BW", brazil: "BR", bulgaria: "BG", cambodia: "KH",
  canada: "CA", chile: "CL", china: "CN", colombia: "CO", "costa rica": "CR", croatia: "HR",
  cuba: "CU", cyprus: "CY", "czech republic": "CZ", czechia: "CZ", denmark: "DK", ecuador: "EC",
  egypt: "EG", "el salvador": "SV", england: "GB", estonia: "EE", ethiopia: "ET", faroes: "FO",
  "faroe islands": "FO", finland: "FI", france: "FR", georgia: "GE", germany: "DE", ghana: "GH",
  greece: "GR", guatemala: "GT", honduras: "HN", "hong kong": "HK", hungary: "HU", iceland: "IS",
  india: "IN", indonesia: "ID", iran: "IR", iraq: "IQ", ireland: "IE", israel: "IL", italy: "IT",
  jamaica: "JM", japan: "JP", jordan: "JO", kazakhstan: "KZ", kenya: "KE", kosovo: "XK",
  kuwait: "KW", kyrgyzstan: "KG", latvia: "LV", lebanon: "LB", libya: "LY", liechtenstein: "LI",
  lithuania: "LT", luxembourg: "LU", macau: "MO", madagascar: "MG", malaysia: "MY", maldives: "MV",
  malta: "MT", mexico: "MX", moldova: "MD", monaco: "MC", mongolia: "MN", montenegro: "ME",
  morocco: "MA", mozambique: "MZ", myanmar: "MM", namibia: "NA", nepal: "NP", netherlands: "NL",
  "new zealand": "NZ", nicaragua: "NI", nigeria: "NG", "north macedonia": "MK", macedonia: "MK",
  norway: "NO", oman: "OM", pakistan: "PK", palestine: "PS", panama: "PA", paraguay: "PY",
  peru: "PE", philippines: "PH", poland: "PL", portugal: "PT", qatar: "QA", romania: "RO",
  russia: "RU", scotland: "GB", serbia: "RS", singapore: "SG", slovakia: "SK", slovenia: "SI",
  "south africa": "ZA", "south korea": "KR", korea: "KR", spain: "ES", "sri lanka": "LK",
  sudan: "SD", sweden: "SE", switzerland: "CH", syria: "SY", taiwan: "TW", tajikistan: "TJ",
  tanzania: "TZ", thailand: "TH", "timor-leste": "TL", "east timor": "TL", tunisia: "TN",
  turkey: "TR", turkiye: "TR", türkiye: "TR", turkmenistan: "TM", uganda: "UG", ukraine: "UA",
  "united arab emirates": "AE", uae: "AE", "united kingdom": "GB", "united states": "US",
  usa: "US", uruguay: "UY", uzbekistan: "UZ", venezuela: "VE", vietnam: "VN", wales: "GB",
  yemen: "YE", zambia: "ZM", zimbabwe: "ZW",
};

export function teamFlag(team?: string | null): string | null {
  if (!team) return null;
  // Olympiad sections suffix a second team from the same country as "India 2".
  const base = String(team).trim().replace(/\s+\d+$/, "").toLowerCase();
  const iso = ISO2[base];
  if (!iso || iso.length !== 2) return null;
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
