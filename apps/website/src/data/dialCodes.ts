// Dial-code lookup used by the PhoneField country dropdown.
// India first (default market); the rest are alphabetical by name.
// Emoji flags are ISO country-code regional indicators — they render on every
// modern OS/browser without needing a webfont.
//
// Not exhaustive (~80 countries covering the top markets). Add rows as we
// take on customers in new regions. `dial` is the country calling code
// WITHOUT the leading '+' — the UI prepends the '+'.
export interface DialCode {
  name: string
  code: string   // ISO 3166-1 alpha-2, e.g. 'IN'
  dial: string   // country calling code without '+'
  flag: string   // emoji flag
}

export const DIAL_CODES: readonly DialCode[] = [
  { name: 'India',             code: 'IN', dial: '91',  flag: '🇮🇳' },
  // -- alphabetical below ---------------------------------------------------
  { name: 'Argentina',         code: 'AR', dial: '54',  flag: '🇦🇷' },
  { name: 'Australia',         code: 'AU', dial: '61',  flag: '🇦🇺' },
  { name: 'Austria',           code: 'AT', dial: '43',  flag: '🇦🇹' },
  { name: 'Bahrain',           code: 'BH', dial: '973', flag: '🇧🇭' },
  { name: 'Bangladesh',        code: 'BD', dial: '880', flag: '🇧🇩' },
  { name: 'Belgium',           code: 'BE', dial: '32',  flag: '🇧🇪' },
  { name: 'Bhutan',            code: 'BT', dial: '975', flag: '🇧🇹' },
  { name: 'Brazil',            code: 'BR', dial: '55',  flag: '🇧🇷' },
  { name: 'Cambodia',          code: 'KH', dial: '855', flag: '🇰🇭' },
  { name: 'Canada',            code: 'CA', dial: '1',   flag: '🇨🇦' },
  { name: 'Chile',             code: 'CL', dial: '56',  flag: '🇨🇱' },
  { name: 'China',             code: 'CN', dial: '86',  flag: '🇨🇳' },
  { name: 'Colombia',          code: 'CO', dial: '57',  flag: '🇨🇴' },
  { name: 'Czech Republic',    code: 'CZ', dial: '420', flag: '🇨🇿' },
  { name: 'Denmark',           code: 'DK', dial: '45',  flag: '🇩🇰' },
  { name: 'Egypt',             code: 'EG', dial: '20',  flag: '🇪🇬' },
  { name: 'Ethiopia',          code: 'ET', dial: '251', flag: '🇪🇹' },
  { name: 'Finland',           code: 'FI', dial: '358', flag: '🇫🇮' },
  { name: 'France',            code: 'FR', dial: '33',  flag: '🇫🇷' },
  { name: 'Germany',           code: 'DE', dial: '49',  flag: '🇩🇪' },
  { name: 'Ghana',             code: 'GH', dial: '233', flag: '🇬🇭' },
  { name: 'Greece',            code: 'GR', dial: '30',  flag: '🇬🇷' },
  { name: 'Hong Kong',         code: 'HK', dial: '852', flag: '🇭🇰' },
  { name: 'Hungary',           code: 'HU', dial: '36',  flag: '🇭🇺' },
  { name: 'Indonesia',         code: 'ID', dial: '62',  flag: '🇮🇩' },
  { name: 'Iran',              code: 'IR', dial: '98',  flag: '🇮🇷' },
  { name: 'Iraq',              code: 'IQ', dial: '964', flag: '🇮🇶' },
  { name: 'Ireland',           code: 'IE', dial: '353', flag: '🇮🇪' },
  { name: 'Israel',            code: 'IL', dial: '972', flag: '🇮🇱' },
  { name: 'Italy',             code: 'IT', dial: '39',  flag: '🇮🇹' },
  { name: 'Japan',             code: 'JP', dial: '81',  flag: '🇯🇵' },
  { name: 'Jordan',            code: 'JO', dial: '962', flag: '🇯🇴' },
  { name: 'Kenya',             code: 'KE', dial: '254', flag: '🇰🇪' },
  { name: 'Kuwait',            code: 'KW', dial: '965', flag: '🇰🇼' },
  { name: 'Malaysia',          code: 'MY', dial: '60',  flag: '🇲🇾' },
  { name: 'Maldives',          code: 'MV', dial: '960', flag: '🇲🇻' },
  { name: 'Mexico',            code: 'MX', dial: '52',  flag: '🇲🇽' },
  { name: 'Morocco',           code: 'MA', dial: '212', flag: '🇲🇦' },
  { name: 'Myanmar',           code: 'MM', dial: '95',  flag: '🇲🇲' },
  { name: 'Nepal',             code: 'NP', dial: '977', flag: '🇳🇵' },
  { name: 'Netherlands',       code: 'NL', dial: '31',  flag: '🇳🇱' },
  { name: 'New Zealand',       code: 'NZ', dial: '64',  flag: '🇳🇿' },
  { name: 'Nigeria',           code: 'NG', dial: '234', flag: '🇳🇬' },
  { name: 'Norway',            code: 'NO', dial: '47',  flag: '🇳🇴' },
  { name: 'Oman',              code: 'OM', dial: '968', flag: '🇴🇲' },
  { name: 'Pakistan',          code: 'PK', dial: '92',  flag: '🇵🇰' },
  { name: 'Peru',              code: 'PE', dial: '51',  flag: '🇵🇪' },
  { name: 'Philippines',       code: 'PH', dial: '63',  flag: '🇵🇭' },
  { name: 'Poland',            code: 'PL', dial: '48',  flag: '🇵🇱' },
  { name: 'Portugal',          code: 'PT', dial: '351', flag: '🇵🇹' },
  { name: 'Qatar',             code: 'QA', dial: '974', flag: '🇶🇦' },
  { name: 'Romania',           code: 'RO', dial: '40',  flag: '🇷🇴' },
  { name: 'Russia',            code: 'RU', dial: '7',   flag: '🇷🇺' },
  { name: 'Saudi Arabia',      code: 'SA', dial: '966', flag: '🇸🇦' },
  { name: 'Singapore',         code: 'SG', dial: '65',  flag: '🇸🇬' },
  { name: 'South Africa',      code: 'ZA', dial: '27',  flag: '🇿🇦' },
  { name: 'South Korea',       code: 'KR', dial: '82',  flag: '🇰🇷' },
  { name: 'Spain',             code: 'ES', dial: '34',  flag: '🇪🇸' },
  { name: 'Sri Lanka',         code: 'LK', dial: '94',  flag: '🇱🇰' },
  { name: 'Sweden',            code: 'SE', dial: '46',  flag: '🇸🇪' },
  { name: 'Switzerland',       code: 'CH', dial: '41',  flag: '🇨🇭' },
  { name: 'Taiwan',            code: 'TW', dial: '886', flag: '🇹🇼' },
  { name: 'Tanzania',          code: 'TZ', dial: '255', flag: '🇹🇿' },
  { name: 'Thailand',          code: 'TH', dial: '66',  flag: '🇹🇭' },
  { name: 'Türkiye',           code: 'TR', dial: '90',  flag: '🇹🇷' },
  { name: 'Uganda',            code: 'UG', dial: '256', flag: '🇺🇬' },
  { name: 'Ukraine',           code: 'UA', dial: '380', flag: '🇺🇦' },
  { name: 'United Arab Emirates', code: 'AE', dial: '971', flag: '🇦🇪' },
  { name: 'United Kingdom',    code: 'GB', dial: '44',  flag: '🇬🇧' },
  { name: 'United States',     code: 'US', dial: '1',   flag: '🇺🇸' },
  { name: 'Uruguay',           code: 'UY', dial: '598', flag: '🇺🇾' },
  { name: 'Vietnam',           code: 'VN', dial: '84',  flag: '🇻🇳' },
  { name: 'Yemen',             code: 'YE', dial: '967', flag: '🇾🇪' },
  { name: 'Zambia',            code: 'ZM', dial: '260', flag: '🇿🇲' },
]

export const DEFAULT_DIAL_CODE: DialCode = DIAL_CODES[0]  // India

export function findDialByCode(code: string): DialCode | undefined {
  return DIAL_CODES.find((c) => c.code === code)
}
