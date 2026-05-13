// WCA country ID (English name used as ID in WCA DB) → ISO 3166-1 alpha-2
const MAP: Record<string, string> = {
  Afghanistan: "AF", Albania: "AL", Algeria: "DZ", Andorra: "AD", Angola: "AO",
  Argentina: "AR", Armenia: "AM", Australia: "AU", Austria: "AT", Azerbaijan: "AZ",
  Bahrain: "BH", Bangladesh: "BD", Belarus: "BY", Belgium: "BE", Bolivia: "BO",
  "Bosnia and Herzegovina": "BA", Brazil: "BR", Bulgaria: "BG", Cambodia: "KH",
  Cameroon: "CM", Canada: "CA", Chile: "CL", China: "CN", Colombia: "CO",
  "Costa Rica": "CR", Croatia: "HR", Cuba: "CU", Cyprus: "CY",
  "Czech Republic": "CZ", Denmark: "DK", "Dominican Republic": "DO", Ecuador: "EC",
  Egypt: "EG", "El Salvador": "SV", Estonia: "EE", Ethiopia: "ET", Finland: "FI",
  France: "FR", Georgia: "GE", Germany: "DE", Ghana: "GH", Gibraltar: "GI",
  Greece: "GR", Guatemala: "GT", Honduras: "HN", "Hong Kong": "HK", Hungary: "HU",
  Iceland: "IS", India: "IN", Indonesia: "ID", Iran: "IR", Iraq: "IQ",
  Ireland: "IE", Israel: "IL", Italy: "IT", Japan: "JP", Jordan: "JO",
  Kazakhstan: "KZ", Kenya: "KE", Kosovo: "XK", Kuwait: "KW", Kyrgyzstan: "KG",
  Latvia: "LV", Lebanon: "LB", Liechtenstein: "LI", Lithuania: "LT",
  Luxembourg: "LU", Macau: "MO", Malaysia: "MY", Malta: "MT", Mexico: "MX",
  Moldova: "MD", Monaco: "MC", Mongolia: "MN", Montenegro: "ME", Morocco: "MA",
  Mozambique: "MZ", Nepal: "NP", Netherlands: "NL", "New Zealand": "NZ",
  Nicaragua: "NI", Nigeria: "NG", "North Macedonia": "MK", Norway: "NO",
  Oman: "OM", Pakistan: "PK", Palestine: "PS", Panama: "PA", Paraguay: "PY",
  Peru: "PE", Philippines: "PH", Poland: "PL", Portugal: "PT", "Puerto Rico": "PR",
  Qatar: "QA", Romania: "RO", Russia: "RU", "Saudi Arabia": "SA", Senegal: "SN",
  Serbia: "RS", Singapore: "SG", Slovakia: "SK", Slovenia: "SI",
  "South Africa": "ZA", "South Korea": "KR", Spain: "ES", "Sri Lanka": "LK",
  Sweden: "SE", Switzerland: "CH", Syria: "SY", Taiwan: "TW", Tajikistan: "TJ",
  Thailand: "TH", Tunisia: "TN", Turkey: "TR", Turkmenistan: "TM", Uganda: "UG",
  Ukraine: "UA", "United Arab Emirates": "AE", "United Kingdom": "GB",
  "United States": "US", Uruguay: "UY", Uzbekistan: "UZ", Venezuela: "VE",
  Vietnam: "VN", Yemen: "YE", Zimbabwe: "ZW",
};

export function wcaCountryToIso2(wcaCountryId: string): string {
  return MAP[wcaCountryId] ?? "";
}
