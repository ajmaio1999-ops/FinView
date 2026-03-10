import { useState, useCallback, useMemo, useEffect } from 'react';
import { BarChart, Bar, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine, ComposedChart } from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════════
   FINVIEW v6 — Personal Finance Dashboard
   Auto-Learn · Split Txns · Recurring · Rules · Net Worth · Insights
   Cash Flow · Export · Mobile Responsive · Persistent Storage
   ═══════════════════════════════════════════════════════════════════════════ */

// ── STORAGE (localStorage — works in any browser, data persists across sessions) ──
const ST = {
  async get(k) { try { const v = localStorage.getItem(`fv6-${k}`); return v ? JSON.parse(v) : null; } catch { return null; } },
  async set(k, v) { try { localStorage.setItem(`fv6-${k}`, JSON.stringify(v)); return true; } catch { return false; } },
  async del(k) { try { localStorage.removeItem(`fv6-${k}`); return true; } catch { return false; } },
};

// ── UTILITIES ───────────────────────────────────────────────────────────────
const parseAmt = v => { if (v == null || v === '') return 0; return parseFloat(String(v).replace(/[$,+\s]/g, '')) || 0; };
const parseDate = v => {
  if (!v) return new Date().toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; }
  try { return new Date(v).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); }
};
const splitCSV = line => { const r = []; let c = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') q = !q; else if (ch === ',' && !q) { r.push(c.trim()); c = ''; } else c += ch; } r.push(c.trim()); return r; };
const csvToRows = text => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const SIGS = ['date','timestamp','description','amount','account','transaction','debit','credit','posting'];
  let hi = -1;
  for (let i = 0; i < Math.min(lines.length, 15); i++) { const cols = splitCSV(lines[i]).map(c => c.toLowerCase().replace(/"/g, '').trim()); if (cols.length >= 3 && cols.filter(c => SIGS.some(s => c.includes(s))).length >= 2) { hi = i; break; } }
  if (hi < 0) return [];
  const hdrs = splitCSV(lines[hi]).map(h => h.toLowerCase().replace(/"/g, '').trim());
  const rows = [];
  for (let i = hi + 1; i < lines.length; i++) { const line = lines[i].trim(); if (!line || line.startsWith('"The data') || line.startsWith('Brokerage')) break; const vals = splitCSV(line); if (vals.every(v => !v)) continue; const obj = {}; hdrs.forEach((h, idx) => { obj[h] = (vals[idx] || '').replace(/"/g, '').trim(); }); rows.push(obj); }
  return rows;
};
const fmt = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
const fmtD = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtK = n => { const a = Math.abs(n || 0); if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`; return fmt(n); };
const MTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const mkey = d => d ? String(d).slice(0, 7) : '';
const pLabel = p => { if (!p || p === 'all') return 'All Time'; if (p === 'ytd') return `YTD ${new Date().getFullYear()}`; const [y, m] = p.split('-'); return `${MTHS[parseInt(m) - 1]} ${y}`; };
const filtr = (txns, p) => { if (!p || p === 'all') return txns; if (p === 'ytd') { const y = String(new Date().getFullYear()); return txns.filter(t => t.date?.startsWith(y)); } return txns.filter(t => t.date?.startsWith(p)); };
const calcSum = txns => {
  const income = txns.filter(t => t.amt > 0 && t.cat !== 'Investing' && t.cat !== 'Transfer').reduce((s, t) => s + t.amt, 0);
  const expenses = txns.filter(t => t.amt < 0 && t.cat !== 'Investing' && t.cat !== 'Transfer').reduce((s, t) => s + Math.abs(t.amt), 0);
  const invested = txns.filter(t => t.cat === 'Investing' && t.amt < 0).reduce((s, t) => s + Math.abs(t.amt), 0);
  return { income, expenses, invested, net: income - expenses, rate: income > 0 ? ((income - expenses) / income) * 100 : 0 };
};

// ── CATEGORY ENGINE (600+ vendor patterns) ──────────────────────────────────
const CR = [
  [/whole foods|trader joe|wegmans|aldi|safeway|kroger|publix|stop.?shop|shop.?rite|food.?lion|giant eagle|h.?e.?b|meijer|sprouts|fresh market|fresh direct|instacart|peapod|imperfect foods|thrive market|food emporium|key food|gristedes|fairway|morton williams|dagostino|citarella|eataly|food bazaar|c.?town|piggly wiggly|winn.?dixie|harris teeter|fred meyer|ralph.?s|vons|albertsons|jewel.?osco|acme market|giant food|food 4 less|grocery outlet|save.?a.?lot|lidl|market basket|winco|stater bros|smart.?final|natural grocers/i, 'Groceries'],
  [/grubhub|doordash|uber eats|seamless|postmates|caviar|ritual|chowbus|hungryroot|factor ?75|hello ?fresh|blue apron|every ?plate|home ?chef|sun ?basket|daily ?harvest|freshly|snap kitchen|tovala|gobble|dinnerly|green chef/i, 'Dining Out'],
  [/chipotle|mcdonalds|mcdonald|shake shack|chick.?fil|panera|five guys|wendy|burger king|taco bell|popeyes|wingstop|raising cane|in.?n.?out|whataburger|panda express|subway|firehouse sub|jersey mike|potbelly|jimmy john|noodles|mod pizza|blaze pizza|domino|papa john|little caesar|pizza hut|kfc|arby|sonic drive|jack in the box|carl.?s jr|hardee|del taco|el pollo|culver|cook ?out|zaxby|cava|sweetgreen|au bon pain|pret a manger/i, 'Dining Out'],
  [/starbucks|dunkin|peet.?s coffee|blue bottle|philz|la colombe|intelligentsia|tim horton|caribou coffee|dutch bros|coffee bean|gregorys|think coffee|birch coffee|joe coffee|devocion|cafe|bakery|boba|tea house|jamba juice|smoothie king|tropical smoothie|pressed juicery|juice press/i, 'Dining Out'],
  [/restaurant|dining|eatery|bistro|trattoria|brasserie|tavern|grill|steakhouse|sushi|ramen|pho|thai food|indian food|mexican food|italian food|chinese food|japanese food|korean food|mediterranean|deli |diner |brunch|pizzeria|cantina|taqueria|izakaya|gastropub|oyster bar|food hall|kitchen |waffle|pancake|breakfast|bbq |barbecue|seafood|noodle|curry|dim sum|dumpling|buffet|catering/i, 'Dining Out'],
  [/bar tab|happy hour|brewery|taproom|wine bar|cocktail|lounge|pub |speakeasy|nightclub|liquor store|wine shop|total wine|abc fine wine|bevmo|spec.?s|binny/i, 'Dining Out'],
  [/uber(?! eats)|lyft|via ride|curb mobility/i, 'Transportation'],
  [/mta|citi.?bike|metro.?card|metro.?north|nj transit|lirr|amtrak|path train|bart|caltrain|wmata|septa|mbta|cta|trimet|metro rail|light rail|subway|transit|bus fare|clipper card|ventra|smartrip/i, 'Transportation'],
  [/parking|park ?mobile|spot ?hero|eztoll|ez.?pass|toll|sunpass|fastrak|zipcar|turo|enterprise rent|hertz|avis|budget rent|national car/i, 'Transportation'],
  [/gas station|shell oil|exxon|mobil gas|chevron|bp station|speedway|wawa|sheetz|circle k|pilot travel|racetrac|quiktrip|sunoco|valero|marathon petro|citgo|phillips 66|7.?eleven fuel|buc.?ee|murphy usa|casey|kwik trip/i, 'Transportation'],
  [/car wash|jiffy lube|valvoline|meineke|pep boys|autozone|advance auto|o.?reilly auto|napa auto|firestone|goodyear|discount tire|mavis|safelite|car repair|mechanic|oil change|midas muffler|aamco/i, 'Transportation'],
  [/car insurance|auto insurance|geico|progressive|state farm auto|allstate auto|usaa auto|liberty mutual auto|root insurance/i, 'Transportation'],
  [/car payment|auto loan|car lease|honda financial|toyota financial|ford credit|gm financial|bmw financial|hyundai motor finance/i, 'Transportation'],
  [/delta air|united air|american air|southwest air|jetblue|spirit air|frontier air|alaska air|hawaiian air|allegiant|icelandair|british airways|lufthansa|air france|klm|emirates|qatar air|singapore air|air canada|ryanair|easyjet/i, 'Travel'],
  [/airbnb|vrbo|booking\.com|hotels\.com|expedia|kayak|hopper|priceline|agoda|marriott|hilton|hyatt|ihg|wyndham|best western|four seasons|ritz.?carlton|sheraton|westin|holiday inn|hampton inn|comfort inn/i, 'Travel'],
  [/global entry|tsa pre|clear plus|priority pass|travel insurance|viator|cruise|carnival cruise|royal caribbean|norwegian cruise/i, 'Travel'],
  [/netflix|spotify|hulu|disney\+|amazon prime|youtube premium|youtube music|apple tv|hbo max|max\.com|peacock|paramount\+|showtime|starz|crunchyroll|mubi|criterion|dazn|espn\+|fubo tv|sling tv|apple music|tidal|amazon music|pandora|sirius ?xm/i, 'Subscriptions'],
  [/chatgpt|openai|claude|anthropic|cursor|github|copilot|notion|dropbox|google one|icloud|adobe|creative cloud|figma|canva|slack|zoom|microsoft 365|office 365|1password|nordvpn|expressvpn|proton|grammarly|midjourney|perplexity/i, 'Subscriptions'],
  [/duolingo|audible|kindle unlimited|masterclass|skillshare|coursera|udemy|linkedin learning|brilliant|medium|substack|patreon|the athletic|nyt|new york times|washington post|wall street journal|bloomberg\.com|financial times|economist/i, 'Subscriptions'],
  [/playstation|xbox|nintendo|steam|epic games|ea play|game pass|twitch|discord nitro|roblox|minecraft/i, 'Subscriptions'],
  [/headspace|calm|noom|strava|alltrails|whoop|oura ring|peloton digital|apple one|google play|app store|fitbit premium|myfitnesspal/i, 'Subscriptions'],
  [/phone bill|cell phone|wireless|t-mobile|at&t wireless|verizon wireless|mint mobile|visible|cricket wireless|boost mobile|google fi/i, 'Subscriptions'],
  [/rent payment|monthly rent|apartment rent|lease payment|mortgage|hoa |association fee|property tax|property management|landlord|leasing office/i, 'Housing'],
  [/con.?ed|coned|con edison|pseg|pge|pg&e|duke energy|dominion energy|national grid|eversource|xcel energy|utility|utilities|electric bill|gas bill|water bill|sewer|waste management/i, 'Housing'],
  [/verizon fios|at&t internet|spectrum|comcast|xfinity|optimum|cox comm|frontier comm|centurylink|google fiber|starlink/i, 'Housing'],
  [/renters insurance|homeowners insurance|home insurance|lemonade|state farm home|flood insurance|umbrella insurance/i, 'Housing'],
  [/cleaning service|maid|molly maid|handy\.com|taskrabbit|thumbtack|lawn care|landscaping|pest control|orkin|terminix|plumber|electrician|hvac|handyman|locksmith/i, 'Housing'],
  [/laundry|dry clean|wash.?fold|laundromat/i, 'Housing'],
  [/furniture|mattress|casper|tempurpedic|sleep number|ashley furniture|ikea|wayfair|article\.com|joybird|arhaus|burrow/i, 'Housing'],
  [/cvs|walgreens|rite aid|duane reade|pharmacy|rx |prescription|amazon pharmacy|pillpack/i, 'Healthcare'],
  [/doctor|physician|pediatric|dermatolog|orthoped|cardiolog|neurolog|gastro|urolog|oncolog|ophthalmolog|optometr|chiropract|physical therap|allergist/i, 'Healthcare'],
  [/dentist|dental|orthodont|invisalign|aspen dental|smile direct/i, 'Healthcare'],
  [/therap|psycholog|psychiatr|counsel|mental health|betterhelp|talkspace|cerebral|lyra health|spring health|headway|alma/i, 'Healthcare'],
  [/hospital|urgent care|emergency room|minute clinic|citymd|carbon health|one medical|zocdoc|teladoc|labcorp|quest diagnostic|kaiser/i, 'Healthcare'],
  [/equinox|crunch|planet fitness|24 hour fitness|lifetime fitness|orangetheory|barry.?s boot|soulcycle|peloton|classpass|crossfit|ymca|blink fitness|la fitness|gold.?s gym|anytime fitness|f45|solidcore|pure barre|club pilates|corepower|yoga|boxing|martial arts|kickboxing/i, 'Healthcare'],
  [/vitamin|supplement|gnc|vitamin shoppe|athletic green|hims|hers|ro health/i, 'Healthcare'],
  [/health insurance|aetna|cigna|united health|anthem|humana|kaiser|blue cross|blue shield|oscar health|copay|deductible|premium payment|cobra/i, 'Healthcare'],
  [/vision|lenscrafters|warby parker|contacts|glasses|zenni/i, 'Healthcare'],
  [/amazon(?! prime)|target|walmart|costco|sam.?s club|bj.?s wholesale|marshalls|tj.?maxx|ross dress|burlington|dollar tree|dollar general|five below|container store|crate.?barrel|pottery barn|west elm|big lots/i, 'Shopping'],
  [/zara|h&m|uniqlo|gap |old navy|banana republic|j\.?crew|madewell|everlane|aritzia|lululemon|athleta|nike|adidas|new balance|puma|under armour|ralph lauren|nordstrom|neiman marcus|saks|bloomingdale|anthropologie|free people|urban outfitter|asos|abercrombie|american eagle|ann taylor|loft/i, 'Shopping'],
  [/apple store|apple\.com\/shop|best buy|micro center|b&h photo|adorama|samsung|dell|lenovo|newegg|staples|gamestop/i, 'Shopping'],
  [/home depot|lowe.?s|ace hardware|harbor freight|wayfair|overstock|sherwin.?williams/i, 'Shopping'],
  [/sephora|ulta|glossier|fenty|bath.?body works|kiehl|aesop|le labo|aveda|drybar|mac cosmetics|clinique|estee lauder|lancome|benefit|tarte|urban decay|elf cosmetics|nyx|rare beauty|kosas|ilia/i, 'Shopping'],
  [/petco|petsmart|chewy|barkbox|farmer.?s dog|rover\.com|pet supplies|vet|veterinar|animal hospital|pet food|grooming/i, 'Shopping'],
  [/barnes.?noble|book|strand|guitar center|dick.?s sporting|rei |bass pro|cabela|academy sports/i, 'Shopping'],
  [/etsy|ebay|mercari|poshmark|depop|thredup|the realreal|stockx|goat\.com/i, 'Shopping'],
  [/hair ?cut|hair salon|barber|super ?cuts|great clips|sport clips|nail salon|manicure|pedicure|spa |massage|facial|waxing|european wax|brow|lash|tattoo|piercing|tanning/i, 'Personal Care'],
  [/tuition|university|college|school|academy|course|class|lesson|tutoring|chegg|quizlet|codecademy|pluralsight|textbook|student loan|navient|nelnet|mohela|sofi student/i, 'Education'],
  [/movie|cinema|amc theatre|regal cinema|cinemark|imax|fandango|concert|ticketmaster|stubhub|seatgeek|eventbrite|museum|gallery|zoo|aquarium|theme park|disney land|universal studio|six flags|escape room|bowling|arcade|dave.?buster|topgolf|mini golf|comedy club|theatre|theater|broadway|ballet|opera|symphony|karaoke/i, 'Entertainment'],
  [/daycare|childcare|preschool|babysit|nanny|care\.com|bright horizons|kindercare|toys|carter.?s|oshkosh/i, 'Kids & Family'],
  [/gift|present|flowers|1-800-flowers|florist|hallmark|charity|donation|donate|gofundme|nonprofit|foundation|red cross|united way|salvation army|goodwill|church|temple|mosque|synagogue|tithe/i, 'Gifts & Donations'],
  [/fidelity|vanguard|schwab|td ameritrade|e.?trade|etrade|robinhood|webull|sofi invest|betterment|wealthfront|acorns|stash|m1 finance|interactive brokers|ally invest|merrill|morgan stanley|goldman sachs|jpmorgan|edward jones/i, 'Investing'],
  [/coinbase|binance|kraken|gemini|crypto\.com|bitcoin|ethereum|crypto/i, 'Investing'],
  [/401k|ira|roth|brokerage transfer|investment|etf purchase|mutual fund|stock purchase|bond purchase|treasury/i, 'Investing'],
  [/payroll|salary|direct deposit|adp|paychex|gusto|rippling|justworks|paylocity|compensation|employer|pension|social security/i, 'Income'],
  [/interest earned|savings interest|dividend|tax refund|irs refund|state refund|referral bonus|sign.?up bonus|reward redemption/i, 'Income'],
  [/venmo.*from|zelle.*from|paypal.*from|cash app.*from|received from|incoming transfer|ach credit|deposit from/i, 'Income'],
  [/credit card payment|card payment|statement payment|minimum payment|autopay/i, 'Transfer'],
  [/transfer to|transfer from|internal transfer|account transfer|moving money|sweep/i, 'Transfer'],
  [/tax prep|h&r block|turbotax|jackson hewitt|cpa|accountant|quickbooks|freshbooks/i, 'Financial Fees'],
  [/bank fee|overdraft|nsf fee|maintenance fee|service charge|wire fee|atm fee|foreign transaction|late fee|annual fee|finance charge|interest charge/i, 'Financial Fees'],
  [/legal|attorney|lawyer|law firm|notary|court|filing fee|legal zoom/i, 'Financial Fees'],
];

// Category engine: learned rules → custom rules → built-in rules
function guessCat(desc, learnedRules = [], customRules = []) {
  const d = (desc || '').toLowerCase();
  // 1. Learned rules (from recategorizations) — highest priority
  for (const rule of learnedRules) {
    try {
      if (d.includes(rule.pattern.toLowerCase())) return rule.category;
    } catch {}
  }
  // 2. Custom rules (user-created)
  for (const rule of customRules) {
    try {
      if (rule.matchType === 'contains' && d.includes(rule.pattern.toLowerCase())) return rule.category;
      if (rule.matchType === 'startsWith' && d.startsWith(rule.pattern.toLowerCase())) return rule.category;
      if (rule.matchType === 'exact' && d === rule.pattern.toLowerCase()) return rule.category;
      if (rule.matchType === 'regex' && new RegExp(rule.pattern, 'i').test(d)) return rule.category;
    } catch {}
  }
  // 3. Built-in rules
  for (const [re, cat] of CR) if (re.test(d)) return cat;
  return 'Other';
}

const CATS = {
  'Groceries': { color: '#22c55e', icon: '🥬' }, 'Dining Out': { color: '#f59e0b', icon: '🍽️' },
  'Transportation': { color: '#06b6d4', icon: '🚗' }, 'Travel': { color: '#8b5cf6', icon: '✈️' },
  'Subscriptions': { color: '#a855f7', icon: '📱' }, 'Housing': { color: '#6366f1', icon: '🏠' },
  'Healthcare': { color: '#ef4444', icon: '💊' }, 'Shopping': { color: '#f97316', icon: '🛍️' },
  'Personal Care': { color: '#ec4899', icon: '💅' }, 'Education': { color: '#14b8a6', icon: '📚' },
  'Entertainment': { color: '#e879f9', icon: '🎬' }, 'Kids & Family': { color: '#fb923c', icon: '👶' },
  'Gifts & Donations': { color: '#f472b6', icon: '🎁' }, 'Investing': { color: '#3b82f6', icon: '📈' },
  'Income': { color: '#10b981', icon: '💰' }, 'Transfer': { color: '#64748b', icon: '🔄' },
  'Financial Fees': { color: '#ef4444', icon: '🏦' }, 'Other': { color: '#94a3b8', icon: '📌' },
};

// ── VENDOR NORMALIZATION (for auto-learning & recurring) ────────────────────
function normVendor(desc) {
  return (desc || '').toLowerCase()
    .replace(/[#*\d]+$/g, '')
    .replace(/\s+(ca|ny|tx|il|fl|wa|co|ma|pa|nj|ga|nc|oh|va|az|mn|wi|mo|md|in|or|ct|sc|la|ky|ok|ia|ut|ar|ms|ks|nv|nm|ne|wv|id|hi|me|nh|ri|mt|de|sd|nd|vt|wy|ak|dc)\b/gi, '')
    .replace(/\b\d{3,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[^a-z0-9\s&'.]/g, '')
    .trim()
    .slice(0, 40);
}

// ── RECURRING TRANSACTION DETECTOR ──────────────────────────────────────────
function detectRecurring(txns) {
  const exp = txns.filter(t => t.amt < 0 && t.cat !== 'Transfer' && !t.splitOf);
  const groups = {};
  exp.forEach(t => { const k = normVendor(t.desc); if (!k || k.length < 3) return; if (!groups[k]) groups[k] = []; groups[k].push(t); });
  const out = [];
  Object.entries(groups).forEach(([vendor, txs]) => {
    if (txs.length < 2) return;
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const amts = sorted.map(t => Math.abs(t.amt));
    const med = [...amts].sort((a, b) => a - b)[Math.floor(amts.length / 2)];
    if (amts.filter(a => Math.abs(a - med) / (med || 1) < 0.15).length < sorted.length * 0.6) return;
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(Math.round((new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / 864e5));
    if (!gaps.length) return;
    const avg = gaps.reduce((s, d) => s + d, 0) / gaps.length;
    let freq = null, annual = 0;
    if (avg >= 25 && avg <= 38) { freq = 'monthly'; annual = med * 12; }
    else if (avg >= 80 && avg <= 100) { freq = 'quarterly'; annual = med * 4; }
    else if (avg >= 350 && avg <= 380) { freq = 'yearly'; annual = med; }
    else if (avg >= 12 && avg <= 18 && gaps.length >= 2) { freq = 'biweekly'; annual = med * 26; }
    else if (avg >= 5 && avg <= 10 && gaps.length >= 3) { freq = 'weekly'; annual = med * 52; }
    else return;
    const last = sorted[sorted.length - 1];
    const lastD = new Date(last.date);
    const since = Math.round((new Date() - lastD) / 864e5);
    const next = new Date(lastD);
    if (freq === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (freq === 'quarterly') next.setMonth(next.getMonth() + 3);
    else if (freq === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else if (freq === 'biweekly') next.setDate(next.getDate() + 14);
    else next.setDate(next.getDate() + 7);
    const maxGap = { monthly: 70, quarterly: 200, yearly: 400, biweekly: 35, weekly: 21 }[freq];
    out.push({ vendor, name: txs[0].desc.slice(0, 35), cat: txs[0].cat, amount: med, freq, annual, count: sorted.length, lastDate: last.date, nextDate: next.toISOString().slice(0, 10), active: since < maxGap, since });
  });
  return out.sort((a, b) => b.annual - a.annual);
}

// ── FIDELITY POSITIONS PARSER ────────────────────────────────────────────────
function parseFidelity(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let hi = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].includes('Symbol') && (lines[i].includes('Account') || lines[i].includes('Current Value'))) { hi = i; break; }
  }
  if (hi < 0) return null;
  const hdrs = splitCSV(lines[hi]).map(h => h.toLowerCase().replace(/"/g, '').trim());
  const accounts = {};
  for (let i = hi + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('"The data') || line.startsWith('Brokerage') || line.startsWith('The data')) break;
    const vals = splitCSV(line);
    if (vals.every(v => !v)) continue;
    const row = {};
    hdrs.forEach((h, idx) => { row[h] = (vals[idx] || '').replace(/"/g, '').trim(); });
    const sym = row['symbol'] || '';
    if (!sym || sym === 'Symbol' || sym === 'Pending Activity') continue;
    const acctNum = row['account number'] || row['account'] || 'acct';
    const acctName = row['account name'] || '';
    if (!accounts[acctNum]) accounts[acctNum] = { name: acctName, positions: [], total: 0 };
    const currentVal = parseAmt(row['current value']);
    const pos = {
      symbol: sym.replace('**', ''),
      description: row['description'] || '',
      quantity: parseFloat(row['quantity'] || '0') || 0,
      lastPrice: parseAmt(row['last price']),
      currentVal,
      costBasis: parseAmt(row['cost basis total']),
      totalGain: parseAmt(row['total gain/loss dollar']),
      avgCost: parseAmt(row['average cost basis']),
      isMM: sym.endsWith('**') || (row['description'] || '').toLowerCase().includes('money market'),
    };
    accounts[acctNum].positions.push(pos);
    accounts[acctNum].total += currentVal;
  }
  const totalValue = Object.values(accounts).reduce((s, a) => s + a.total, 0);
  return totalValue > 0 ? { accounts, totalValue } : null;
}

// ── COINBASE PORTFOLIO PARSER ───────────────────────────────────────────────
const CB_SKIP = new Set(['retail staking transfer']);
function findCBHeader(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    if (lines[i].trim().startsWith('ID,') && lines[i].includes('Timestamp')) return i;
  }
  return -1;
}
function parseCBRow(line, hdrs) {
  const vals = splitCSV(line);
  if (vals.length < 5) return null;
  const obj = {};
  hdrs.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/"/g, '').trim(); });
  return obj;
}
function parseCoinbasePortfolio(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const hi = findCBHeader(text);
  if (hi < 0) return null;
  const hdrs = splitCSV(lines[hi]).map(h => h.toLowerCase().replace(/"/g, '').trim());
  const dataLines = [];
  for (let i = hi + 1; i < lines.length; i++) if (lines[i].trim()) dataLines.push(lines[i]);
  dataLines.reverse();
  const H = {};
  const hold = a => { if (!H[a]) H[a] = { asset: a, qty: 0, cost: 0, earned: 0, price: 0, priceDate: '' }; return H[a]; };
  for (const line of dataLines) {
    const row = parseCBRow(line, hdrs);
    if (!row) continue;
    const tx = (row['transaction type'] || '').toLowerCase().trim();
    if (!tx || CB_SKIP.has(tx)) continue;
    const asset = (row['asset'] || '').trim();
    if (!asset || asset === 'USD') continue;
    const qty = parseFloat(row['quantity transacted'] || '0') || 0;
    const price = parseAmt(row['price at transaction'] || '0');
    const total = Math.abs(parseAmt(row['total (inclusive of fees and/or spread)'] || row['subtotal'] || '0'));
    const date = (row['timestamp'] || row['date'] || '').slice(0, 10);
    const h = hold(asset);
    if (price > 0 && date >= h.priceDate) { h.price = price; h.priceDate = date; }
    if (tx === 'buy') { h.qty += qty; h.cost += total; }
    else if (tx === 'sell') { const avg = h.qty > 0 ? h.cost / h.qty : 0; h.cost -= avg * qty; h.qty -= qty; }
    else if (tx === 'staking income' || tx === 'reward income') { h.qty += qty; h.earned += qty; h.cost += total; }
    else if (tx === 'retail eth2 deprecation') { if (asset === 'ETH2' && qty < 0) { hold('ETH').cost += h.cost; h.cost = 0; } h.qty += qty; }
    else if (tx === 'deposit') { h.qty += qty; }
  }
  const holdings = Object.values(H).filter(h => h.qty > 0.000001);
  const totalVal = holdings.reduce((s, h) => s + h.qty * h.price, 0);
  const totalCost = holdings.reduce((s, h) => s + h.cost, 0);
  return { holdings, totalVal, totalCost, gain: totalVal - totalCost, live: false };
}

// ── COINGECKO LIVE PRICES ───────────────────────────────────────────────────
const CG = { ETH: 'ethereum', ETH2: 'ethereum', ADA: 'cardano', BTC: 'bitcoin', SOL: 'solana', USDC: 'usd-coin', MATIC: 'matic-network', DOT: 'polkadot', AVAX: 'avalanche-2' };
async function fetchLive(assets) {
  const ids = [...new Set(assets.map(a => CG[a]).filter(Boolean))];
  if (!ids.length) return {};
  try { const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`); if (!r.ok) return {}; const d = await r.json(); const out = {}; assets.forEach(a => { const id = CG[a]; if (id && d[id]?.usd) out[a] = d[id].usd; }); return out; } catch { return {}; }
}

// ── REFUND / RETURN / CREDIT DETECTION ──────────────────────────────────────
const REFUND_RE = /refund|return|credit|reversal|dispute|chargeback|rebate|adjustment|cashback|cash back|courtesy|reimburse/i;
const TRUE_INCOME_RE = /payroll|salary|direct deposit|adp|paychex|gusto|rippling|justworks|paylocity|interest earned|savings interest|dividend|tax refund|irs refund|state refund|referral bonus|sign.?up bonus|reward redemption|venmo.*from|zelle.*from|paypal.*from|cash app.*from|deposit from|ach credit|wire from|employer|compensation|pension|social security|disability|unemployment/i;
const PAYMENT_RE = /payment thank you|autopay|automatic payment|online payment|payment received|payment.?credit|pymt|pmt received|minimum payment|statement payment|card payment/i;
// Catches credit card bill payments on checking accounts + inter-account transfers
const TRANSFER_RE = /credit card payment|credit crd|cc payment|card payment|statement payment|bill payment|epayment|epay |autopay.*payment|automatic payment|online payment|payment to .*card|pay.*credit.*card|min(?:imum)? payment|(?:chase|jpmcb|jp morgan|american express|amex|capital one|citi(?:bank)?|discover|barclays|synchrony|wells fargo|us bank).*(?:pay|pmt|pymt|auto|epay|credit|bill|crd)|(?:pay|pmt|pymt|auto|epay|bill).*(?:chase|jpmcb|amex|american express|citi|discover|capital one|barclays)|apple card.*(?:pay|gs|goldman)|apple cash.*(?:transfer|send|from)|apple savings|goldman sachs bank|transfer to savings|transfer from savings|transfer to checking|transfer from checking|savings transfer|checking transfer|internal transfer|account transfer|bank transfer|wire transfer|online transfer|ach transfer|sweep transfer|tfr |xfer |between accounts/i;

// ── CSV PARSER (universal — auto-detects Chase, AMEX, Coinbase, Fidelity, generic) ──
function parseCSV(text, accId, settings, learnedRules = [], customRules = [], accType = 'checking') {
  const rows = csvToRows(text); if (!rows.length) return [];
  const top = text.replace(/^\uFEFF/, '').split('\n').slice(0, 10).join('\n').toLowerCase();
  const out = [];
  const tKw = (settings?.transferKeywords || 'internal transfer,account transfer,bank transfer,wire transfer,online transfer').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const iKw = (settings?.investKeywords || 'fidelity,fid bkg,vanguard,schwab,etrade,e*trade,coinbase,robinhood,webull,acorns,betterment,wealthfront').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const rFull = settings?.rentFull || 0, rShare = settings?.rentShare || 0;
  const mates = (settings?.roommates || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

  // ── Format detection (auto — works regardless of account name) ────────
  const hdrs = Object.keys(rows[0] || {}).join(',').toLowerCase();
  const isChase = top.includes('transaction date') && (top.includes('post date') || hdrs.includes('category'));
  const isAmex = top.includes('extended details') || top.includes('appears on your statement') || hdrs.includes('card member');
  const isCB = (top.includes('id,') && top.includes('timestamp')) || (hdrs.includes('transaction type') && hdrs.includes('asset'));
  const isFidelity = top.includes('symbol') && (top.includes('current value') || top.includes('cost basis'));
  const hasDebitCredit = hdrs.includes('debit') || hdrs.includes('credit');
  const isCreditCard = accType === 'credit' || isChase || isAmex;

  // For credit cards without specific detection, check sign convention
  // If most amounts are positive, charges are likely positive (AMEX convention)
  let chargesPositive = false;
  if (isCreditCard && !isChase && !isAmex && !hasDebitCredit) {
    const sample = rows.slice(0, 40).map(r => parseAmt(r['amount'] || '')).filter(v => v !== 0);
    chargesPositive = sample.filter(v => v > 0).length >= sample.length * 0.5;
  }

  if (isFidelity) return []; // Fidelity positions handled separately

  rows.forEach((row, i) => {
    const keys = Object.keys(row);
    const dk = keys.find(k => /^(description|merchant|memo|payee|original description|merchant name)$/i.test(k)) || keys.find(k => k.includes('description')) || 'description';
    const desc = (row[dk] || row['description'] || row['merchant name'] || '').trim() || 'Unknown';
    const lower = desc.toLowerCase();
    const date = parseDate(row['date'] || row['posting date'] || row['transaction date'] || row['timestamp']);
    let amt;

    // ── Format-specific amount parsing ──────────────────────────────────
    if (isChase) {
      // Chase: negative = charge, positive = payment/credit/refund
      amt = parseAmt(row['amount']);
      if (amt > 0) {
        // Positive on Chase CC = payment or refund
        if (PAYMENT_RE.test(lower) || lower.includes('payment') || lower.includes('autopay')) {
          return; // Skip credit card payments
        }
        if (REFUND_RE.test(lower)) {
          // Refund — keep as positive with original vendor category
          out.push({ id: `${accId}-${date}-${i}-${Math.round(amt * 100)}`, date, desc, cat: guessCat(desc, learnedRules, customRules), acc: accId, amt });
          return;
        }
        // Unknown positive on credit card — likely a credit/refund, not income
        if (isCreditCard) {
          out.push({ id: `${accId}-${date}-${i}-${Math.round(amt * 100)}`, date, desc, cat: guessCat(desc, learnedRules, customRules), acc: accId, amt });
          return;
        }
        return; // Skip if unsure
      }
    } else if (isAmex) {
      // AMEX: Classic format has charges as positive, credits as negative
      const raw = parseAmt(row['amount'] || '');
      if (raw === 0) return;
      const sample = rows.slice(0, 30).map(r => parseAmt(r['amount'] || '')).filter(v => v !== 0);
      const pp = sample.filter(v => v > 0).length >= sample.length * 0.5;
      const isCharge = pp ? raw > 0 : raw < 0;
      if (!isCharge) {
        // This is a credit/refund on AMEX — keep as positive offset
        if (REFUND_RE.test(lower)) {
          out.push({ id: `${accId}-${date}-${i}-${Math.round(raw * 100)}`, date, desc, cat: guessCat(desc, learnedRules, customRules), acc: accId, amt: Math.abs(raw) });
          return;
        }
        return; // Skip card payments
      }
      amt = -Math.abs(raw);
    } else if (isCB) {
      // Coinbase: handled by transaction type field
      const tx = (row['transaction type'] || '').toLowerCase().trim();
      if (!tx || CB_SKIP.has(tx) || tx === 'retail eth2 deprecation') return;
      const tot = Math.abs(parseAmt(row['total (inclusive of fees and/or spread)'] || row['subtotal'] || '0'));
      const asset = (row['asset'] || '').trim();
      if (tx === 'buy') out.push({ id: `${accId}-${date}-${i}`, date, desc: `Coinbase: Buy ${asset}`, cat: 'Investing', acc: accId, amt: -tot });
      else if (tx === 'sell') out.push({ id: `${accId}-${date}-${i}`, date, desc: `Coinbase: Sell ${asset}`, cat: 'Income', acc: accId, amt: tot });
      else if (tx.includes('staking') || tx.includes('reward')) out.push({ id: `${accId}-${date}-${i}`, date, desc: `Coinbase: ${asset} Staking`, cat: 'Income', acc: accId, amt: tot });
      return;
    } else if (hasDebitCredit) {
      // TD Bank / generic debit-credit column format
      const d = parseAmt(row['debit']);
      const c = parseAmt(row['credit']);
      amt = c > 0 ? c : -Math.abs(d);
    } else if (isCreditCard && chargesPositive) {
      // Unknown credit card with charges-positive convention
      const raw = parseAmt(row['amount']);
      if (raw === 0) return;
      if (raw > 0) amt = -Math.abs(raw); // Charge
      else {
        if (REFUND_RE.test(lower)) { amt = Math.abs(raw); } // Refund
        else return; // Payment — skip
      }
    } else {
      // Generic bank: negative = expense, positive = income (most common)
      amt = parseAmt(row['amount']);
    }

    if (amt === 0) return;
    const id = `${accId}-${date}-${i}-${Math.round(amt * 100)}`;

    // ── Transfer filtering (catches CC payments on checking, Apple Savings, etc.) ──
    if (tKw.some(kw => kw && lower.includes(kw))) return;
    if (TRANSFER_RE.test(lower)) return;  // Built-in: CC bill payments, inter-account transfers
    if (amt > 0 && lower.includes('zelle') && mates.some(n => n && lower.includes(n))) return;

    // ── Rent netting ────────────────────────────────────────────────────
    if (rFull > 0 && rShare > 0 && amt < 0 && Math.abs(Math.abs(amt) - rFull) < 1) {
      out.push({ id, date, desc: 'Rent (my share)', cat: 'Housing', acc: accId, amt: -rShare });
      return;
    }

    // ── Investment outflows ─────────────────────────────────────────────
    if (amt < 0 && iKw.some(kw => kw && lower.includes(kw))) {
      out.push({ id, date, desc, cat: 'Investing', acc: accId, amt });
      return;
    }

    // ── Income vs expense classification ────────────────────────────────
    if (amt > 0) {
      // Positive amount — is it truly income or a refund/credit?
      if (TRUE_INCOME_RE.test(lower)) {
        out.push({ id, date, desc, cat: 'Income', acc: accId, amt });
      } else if (REFUND_RE.test(lower)) {
        // Refund: keep as positive but categorize by vendor
        out.push({ id, date, desc, cat: guessCat(desc, learnedRules, customRules), acc: accId, amt });
      } else if (isCreditCard) {
        // Credit card positive = likely refund or credit, not income
        out.push({ id, date, desc, cat: guessCat(desc, learnedRules, customRules), acc: accId, amt });
      } else {
        // Checking/savings: positive without income keywords — could be transfer, misc credit
        // Check if it matches any expense category (Zelle, Venmo to = expense)
        const catGuess = guessCat(desc, learnedRules, customRules);
        if (catGuess !== 'Other') {
          // Matched a known category — likely a P2P payment or income from that source
          out.push({ id, date, desc, cat: catGuess === 'Income' ? 'Income' : catGuess, acc: accId, amt });
        } else {
          // Default: large positives likely income, small ones could be refunds
          out.push({ id, date, desc, cat: amt > 50 ? 'Income' : 'Other', acc: accId, amt });
        }
      }
    } else {
      // Negative = expense
      out.push({ id, date, desc, cat: guessCat(desc, learnedRules, customRules), acc: accId, amt });
    }
  });
  return out;
}

function fp(t) { return `${t.date}|${Math.round(t.amt * 100)}|${(t.desc || '').slice(0, 24).toLowerCase()}`; }
function mergeT(ex, inc, accId) { const prev = ex.filter(t => t.acc === accId && !t.splitOf); const oth = ex.filter(t => t.acc !== accId || t.splitOf); const seen = new Set(prev.map(fp)); return [...oth, ...prev, ...inc.filter(t => !seen.has(fp(t)))].sort((a, b) => b.date.localeCompare(a.date)); }

// ── THEME (warm light mode — modern fintech) ───────────────────────────────
const FU = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800&family=JetBrains+Mono:wght@400;600;700&display=swap';
const T = { bg: '#f8f6f2', sf: '#ffffff', sfh: '#f1efe9', bd: 'rgba(0,0,0,0.06)', bdl: 'rgba(0,0,0,0.1)', tx: '#1e293b', tm: '#475569', td: '#94a3b8', ac: '#f97066', ag: 'rgba(249,112,102,0.1)', gn: '#10b981', rd: '#ef4444', gd: '#f59e0b', bl: '#3b82f6', f: "'Plus Jakarta Sans', sans-serif", mo: "'JetBrains Mono', monospace", r: 16, rs: 10 };

// ── UI ATOMS ────────────────────────────────────────────────────────────────
const Card = ({ children, style, glow }) => <div style={{ background: T.sf, borderRadius: T.r, border: `1px solid ${T.bd}`, padding: '20px 22px', position: 'relative', overflow: 'hidden', boxShadow: glow ? `0 4px 24px ${glow}18` : '0 1px 3px rgba(0,0,0,0.04)', ...style }}>{children}</div>;
const Stat = ({ label, value, color = T.tx, icon, sub }) => <Card style={{ padding: '16px 18px' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 11, color: T.td, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>{icon && <span style={{ fontSize: 16 }}>{icon}</span>}</div><div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: T.mo, letterSpacing: '-0.02em' }}>{value}</div>{sub && <div style={{ fontSize: 10, color: T.td, marginTop: 4 }}>{sub}</div>}</Card>;
const Btn = ({ children, onClick, active, color = T.ac, style: sx }) => <button onClick={onClick} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: T.f, background: active ? `${color}15` : 'rgba(0,0,0,0.03)', color: active ? color : T.tm, outline: active ? `1.5px solid ${color}55` : 'none', transition: 'all 0.15s', ...sx }}>{children}</button>;
const Badge = ({ children, color = T.ac }) => <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: `${color}12`, color, fontWeight: 700, fontFamily: T.f }}>{children}</span>;
const IS = { width: '100%', background: '#f8f6f2', border: `1.5px solid ${T.bdl}`, borderRadius: T.rs, padding: '10px 14px', color: T.tx, fontSize: 13, fontFamily: T.f, outline: 'none', boxSizing: 'border-box' };

const Tip = ({ active, payload, label }) => { if (!active || !payload?.length) return null; return <div style={{ background: '#fff', border: `1px solid ${T.bd}`, borderRadius: 10, padding: '10px 14px', fontSize: 11, fontFamily: T.f, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}><div style={{ color: T.td, marginBottom: 4, fontSize: 10 }}>{label}</div>{payload.map((p, i) => <div key={i} style={{ color: p.fill || p.color || T.tx, fontFamily: T.mo, fontWeight: 600 }}>{p.name}: {fmtK(p.value)}</div>)}</div>; };

// ── TRANSACTION ROW (with recategorize dropdown + split indicator) ───────────
const TxRow = ({ t, onRecat, onSplit, showSplit = true }) => {
  const m = CATS[t.cat] || CATS.Other; const pos = t.amt >= 0;
  const ac = t.cat === 'Investing' ? '#3b82f6' : t.cat === 'Transfer' ? '#64748b' : pos ? T.gn : T.rd;
  const isSplit = !!t.splitOf;
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: `1px solid ${T.bd}`, background: isSplit ? 'rgba(249,112,102,0.03)' : 'transparent' }}>
    <div style={{ width: 34, height: 34, borderRadius: 10, background: `${m.color}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{isSplit ? '✂️' : m.icon}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc}{isSplit && <span style={{ marginLeft: 4, fontSize: 9, padding: '1px 5px', borderRadius: 4, background: `${T.ac}10`, color: T.ac, fontWeight: 700 }}>SPLIT</span>}</div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 2 }}>
        <span style={{ fontSize: 10, color: T.td }}>{t.date}</span><span style={{ fontSize: 7, color: T.td }}>·</span>
        {onRecat ? <select value={t.cat} onChange={e => onRecat(t.id, e.target.value)} style={{ fontSize: 10, background: 'transparent', border: 'none', color: m.color, fontWeight: 600, cursor: 'pointer', fontFamily: T.f, padding: 0, outline: 'none' }}>{Object.keys(CATS).map(c => <option key={c} value={c} style={{ background: '#fff' }}>{c}</option>)}</select> : <span style={{ fontSize: 10, color: m.color, fontWeight: 600 }}>{t.cat}</span>}
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {showSplit && !isSplit && t.amt < 0 && onSplit && <button onClick={() => onSplit(t)} title="Split transaction" style={{ fontSize: 11, background: 'rgba(0,0,0,0.03)', border: 'none', borderRadius: 6, padding: '3px 6px', color: T.td, cursor: 'pointer' }}>✂</button>}
      <span style={{ fontFamily: T.mo, fontWeight: 700, fontSize: 13, color: ac, whiteSpace: 'nowrap' }}>{pos ? '+' : ''}{fmtD(t.amt)}</span>
    </div>
  </div>;
};

function PeriodSel({ period, onChange, txns }) {
  const [exp, setExp] = useState(false);
  const yr = String(new Date().getFullYear());
  const yg = useMemo(() => { const mks = new Set(); txns.forEach(t => { if (t.date) mks.add(mkey(t.date)); }); const s = [...mks].filter(Boolean).sort().reverse(); const g = {}; s.forEach(mk => { const y = mk.slice(0, 4); if (!g[y]) g[y] = []; g[y].push(mk); }); return g; }, [txns]);
  const ys = Object.keys(yg).sort().reverse(); const tM = yg[yr] || []; const oY = ys.filter(y => y !== yr);
  const mL = mk => MTHS[parseInt(mk.split('-')[1]) - 1];
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <Btn active={period === 'all'} onClick={() => onChange('all')}>All</Btn>
      <Btn active={period === 'ytd'} onClick={() => onChange('ytd')} color={T.bl}>YTD</Btn>
      {tM.map(mk => <Btn key={mk} active={period === mk} onClick={() => onChange(mk)} color={T.gd}>{mL(mk)}</Btn>)}
      {oY.length > 0 && <Btn onClick={() => setExp(e => !e)} color={T.td}>{exp ? '▲' : `▼ ${oY.join(', ')}`}</Btn>}
    </div>
    {exp && oY.map(y => <div key={y} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}><span style={{ fontSize: 10, color: T.td, minWidth: 32 }}>{y}</span>{(yg[y] || []).map(mk => <Btn key={mk} active={period === mk} onClick={() => onChange(mk)} color="#a78bfa">{mL(mk)}</Btn>)}</div>)}
  </div>;
}

// ── SPLIT TRANSACTION MODAL ─────────────────────────────────────────────────
function SplitModal({ txn, onApply, onClose }) {
  const [parts, setParts] = useState([
    { amt: Math.abs(txn.amt * 0.5).toFixed(2), cat: txn.cat, desc: txn.desc },
    { amt: Math.abs(txn.amt * 0.5).toFixed(2), cat: 'Other', desc: txn.desc },
  ]);
  const total = Math.abs(txn.amt);
  const sum = parts.reduce((s, p) => s + (parseFloat(p.amt) || 0), 0);
  const diff = Math.abs(total - sum);
  const valid = diff < 0.02 && parts.every(p => parseFloat(p.amt) > 0);

  const updatePart = (i, key, val) => { const u = [...parts]; u[i] = { ...u[i], [key]: val }; setParts(u); };
  const addPart = () => setParts([...parts, { amt: '0', cat: 'Other', desc: txn.desc }]);
  const removePart = (i) => { if (parts.length <= 2) return; setParts(parts.filter((_, j) => j !== i)); };

  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
    <div onClick={e => e.stopPropagation()} style={{ background: T.sf, borderRadius: T.r, border: `1px solid ${T.bdl}`, padding: '24px 28px', maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 4 }}>✂️ Split Transaction</div>
      <div style={{ fontSize: 12, color: T.tm, marginBottom: 16 }}>{txn.desc} — {fmtD(txn.amt)} on {txn.date}</div>
      <div style={{ marginBottom: 14 }}>
        {parts.map((p, i) => <div key={i} style={{ padding: '12px 14px', borderRadius: T.rs, background: 'rgba(0,0,0,0.02)', border: `1px solid ${T.bd}`, marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: T.td, fontWeight: 600 }}>Part {i + 1}</span>
            {parts.length > 2 && <button onClick={() => removePart(i)} style={{ marginLeft: 'auto', fontSize: 9, background: `${T.rd}12`, border: 'none', borderRadius: 4, padding: '2px 6px', color: T.rd, cursor: 'pointer' }}>Remove</button>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 90 }}><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Amount</label><input type="number" step="0.01" value={p.amt} onChange={e => updatePart(i, 'amt', e.target.value)} style={{ ...IS, padding: '7px 10px', fontSize: 12 }} /></div>
            <div style={{ flex: 1 }}><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Category</label><select value={p.cat} onChange={e => updatePart(i, 'cat', e.target.value)} style={{ ...IS, padding: '7px 10px', fontSize: 12 }}>{Object.keys(CATS).filter(c => !['Income', 'Transfer'].includes(c)).map(c => <option key={c} value={c}>{CATS[c].icon} {c}</option>)}</select></div>
          </div>
        </div>)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <button onClick={addPart} style={{ fontSize: 11, background: 'rgba(0,0,0,0.03)', border: `1px solid ${T.bd}`, borderRadius: 16, padding: '4px 12px', color: T.tm, cursor: 'pointer', fontFamily: T.f }}>+ Add part</button>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: T.td }}>Total: {fmtD(total)}</div>
          <div style={{ fontSize: 11, color: diff < 0.02 ? T.gn : T.rd, fontWeight: 700 }}>Sum: {fmtD(sum)} {diff < 0.02 ? '✓' : `(${fmtD(diff)} off)`}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: T.rs, border: `1px solid ${T.bdl}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: T.f, background: 'transparent', color: T.tm }}>Cancel</button>
        <button onClick={() => { if (valid) onApply(txn, parts); }} disabled={!valid} style={{ flex: 2, padding: '10px', borderRadius: T.rs, border: 'none', cursor: valid ? 'pointer' : 'default', fontSize: 12, fontWeight: 700, fontFamily: T.f, background: valid ? T.ac : 'rgba(0,0,0,0.04)', color: valid ? '#fff' : T.td }}>Apply Split</button>
      </div>
    </div>
  </div>;
}

// ── AUTO-LEARN TOAST ────────────────────────────────────────────────────────
function LearnToast({ txn, newCat, matchCount, onApplyAll, onDismiss }) {
  if (!txn) return null;
  const vendor = normVendor(txn.desc);
  return <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 150, background: T.sf, border: `1px solid ${T.ac}44`, borderRadius: 14, padding: '14px 20px', boxShadow: `0 8px 40px rgba(0,0,0,0.5), 0 0 30px ${T.ac}10`, maxWidth: 420, width: '90%', display: 'flex', alignItems: 'center', gap: 12 }}>
    <span style={{ fontSize: 20 }}>🧠</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Apply to all "{vendor}"?</div>
      <div style={{ fontSize: 11, color: T.tm }}>{matchCount} other transactions from this vendor would become <span style={{ color: CATS[newCat]?.color, fontWeight: 700 }}>{newCat}</span></div>
    </div>
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={onApplyAll} style={{ padding: '6px 14px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: T.f, background: `${T.ac}22`, color: T.ac }}>Apply All</button>
      <button onClick={onDismiss} style={{ padding: '6px 10px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: T.f, background: 'rgba(0,0,0,0.03)', color: T.td }}>Skip</button>
    </div>
  </div>;
}

// ── ONBOARDING ──────────────────────────────────────────────────────────────
function Onboard({ onDone }) {
  const [name, setName] = useState(''); const [goal, setGoal] = useState('');
  const bs = { width: '100%', padding: '14px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: T.f, background: T.ac, color: '#fff', marginTop: 12, transition: 'transform 0.1s', boxShadow: '0 4px 16px rgba(249,112,102,0.3)' };
  return <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.f, padding: 20 }}>
    <link href={FU} rel="stylesheet" />
    <div style={{ width: '100%', maxWidth: 420 }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: 52, fontWeight: 800, color: T.ac, letterSpacing: '-0.03em' }}>FinView</div>
        <div style={{ fontSize: 16, color: T.tm, marginTop: 6 }}>Your personal finance dashboard</div>
      </div>
      <Card style={{ padding: '32px 28px', boxShadow: '0 8px 40px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.tx, marginBottom: 20 }}>Let's get started</div>
        <div style={{ marginBottom: 16 }}><label style={{ fontSize: 12, color: T.tm, display: 'block', marginBottom: 5, fontWeight: 600 }}>What should we call you?</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={{ ...IS, fontSize: 15, padding: '12px 16px' }} /></div>
        <div style={{ marginBottom: 20 }}><label style={{ fontSize: 12, color: T.tm, display: 'block', marginBottom: 5, fontWeight: 600 }}>Financial goal (optional)</label><input value={goal} onChange={e => setGoal(e.target.value)} placeholder="e.g. Save $10K for a trip" style={{ ...IS, fontSize: 15, padding: '12px 16px' }} /></div>
        <button onClick={() => onDone({ name: name || 'Friend', goal, goalAmt: 0, goalDate: '', rentFull: 0, rentShare: 0, roommates: '', transferKeywords: '', investKeywords: '', budgets: {}, customRules: [], learnedRules: [], dismissedRecurring: [], netWorthHistory: [], accounts: [], goals: [] })} style={bs}>Get Started →</button>
      </Card>
      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: T.td }}>🔒 100% private — all data stays in your browser</div>
    </div>
  </div>;
}

// ── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ txns, period, recurring, settings, balances, fidelityData, coinbaseData, accounts }) {
  const f = useMemo(() => filtr(txns, period), [txns, period]);
  const { income, expenses, invested, net, rate } = calcSum(f);
  const rc = rate >= 30 ? T.gn : rate >= 15 ? T.gd : rate >= 0 ? '#f97316' : T.rd;
  const isMo = /^\d{4}-\d{2}$/.test(period);
  const prev = useMemo(() => { if (!isMo) return null; const [y, m] = period.split('-').map(Number); const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y; const pk = `${py}-${String(pm).padStart(2, '0')}`; const pt = txns.filter(t => t.date?.startsWith(pk)); return pt.length > 0 ? calcSum(pt) : null; }, [txns, period, isMo]);
  const Dl = ({ c, p }) => { if (!p) return null; const d = c - p; const pct = p > 0 ? Math.abs((d / p) * 100).toFixed(0) : '—'; return <span style={{ fontSize: 10, color: d >= 0 ? T.gn : T.rd, fontWeight: 600 }}>{d >= 0 ? '↑' : '↓'}{pct}%</span>; };
  const cs = {}; f.filter(t => t.amt < 0 && !['Investing', 'Transfer'].includes(t.cat)).forEach(t => { cs[t.cat] = (cs[t.cat] || 0) + Math.abs(t.amt); });
  const pd = Object.entries(cs).map(([n, v]) => ({ name: n, value: v, color: CATS[n]?.color || '#94a3b8' })).sort((a, b) => b.value - a.value);
  const roll = useMemo(() => { const now = new Date(); return Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const s = calcSum(txns.filter(t => mkey(t.date) === mk)); return { month: MTHS[d.getMonth()], income: +s.income.toFixed(0), expenses: +s.expenses.toFixed(0), invested: +s.invested.toFixed(0) }; }); }, [txns]);
  const aR = recurring.filter(r => r.active); const mSub = aR.reduce((s, r) => s + (r.freq === 'monthly' ? r.amount : r.annual / 12), 0);
  const lR = settings?.learnedRules?.length || 0;

  // ── Investment tracker data ─────────────────────────────────────────
  const invAccounts = (accounts || []).filter(a => a.type === 'investment' || a.type === 'crypto');
  const totalInvBal = invAccounts.reduce((s, a) => s + (balances?.[a.id] || 0), 0);
  const fPositions = fidelityData ? Object.values(fidelityData.accounts).flatMap(a => a.positions).sort((a, b) => b.currentVal - a.currentVal) : [];
  const cbHoldings = coinbaseData?.holdings || [];
  const totalGain = (fPositions.reduce((s, p) => s + (p.totalGain || 0), 0)) + (coinbaseData?.gain || 0);
  const hasInvestments = totalInvBal > 0 || fPositions.length > 0 || cbHoldings.length > 0;

  // Monthly investment flow (last 12 months)
  const invRoll = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const moTxns = txns.filter(t => mkey(t.date) === mk && t.cat === 'Investing' && t.amt < 0);
      return { month: MTHS[d.getMonth()], invested: moTxns.reduce((s, t) => s + Math.abs(t.amt), 0) };
    });
  }, [txns]);

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="fv-g5"><Stat label="Income" value={fmtK(income)} color={T.gn} icon="💰" sub={prev && <Dl c={income} p={prev.income} />} /><Stat label="Spent" value={fmtK(expenses)} color={T.rd} icon="💸" sub={prev && <Dl c={expenses} p={prev.expenses} />} /><Stat label="Net" value={fmtK(net)} color={net >= 0 ? T.gn : T.rd} icon={net >= 0 ? '🎯' : '⚠️'} sub={prev && <Dl c={net} p={prev.net} />} /><Stat label="Save Rate" value={`${rate.toFixed(1)}%`} color={rc} icon="📊" sub={`${fmtK(invested)} invested`} /><Stat label="Subs" value={`${fmtK(mSub)}/mo`} color={T.ac} icon="🔄" sub={`${aR.length} active · ${lR} learned`} /></div>
    <div className="fv-gm">
      <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>12-Month Overview</div><ResponsiveContainer width="100%" height={190}><BarChart data={roll} barSize={10} barGap={2}><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="month" tick={{ fontSize: 9, fill: T.td }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 9, fill: T.td, fontFamily: T.mo }} tickLine={false} axisLine={false} tickFormatter={fmtK} /><Tooltip content={<Tip />} /><Bar dataKey="income" name="Income" fill={T.gn} radius={[3, 3, 0, 0]} opacity={0.85} /><Bar dataKey="expenses" name="Expenses" fill={T.rd} radius={[3, 3, 0, 0]} opacity={0.85} /></BarChart></ResponsiveContainer></Card>
      <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Spending</div>{pd.length > 0 ? <><ResponsiveContainer width="100%" height={110}><PieChart><Pie data={pd} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" strokeWidth={0}>{pd.map((e, i) => <Cell key={i} fill={e.color} opacity={0.9} />)}</Pie></PieChart></ResponsiveContainer>{pd.slice(0, 5).map(d => <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 5 }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 7, height: 7, borderRadius: 2, background: d.color }} /><span style={{ color: T.tm }}>{d.name}</span></div><span style={{ color: T.tx, fontFamily: T.mo, fontWeight: 600 }}>{fmt(d.value)}</span></div>)}</> : <div style={{ textAlign: 'center', padding: 24, color: T.td }}>No data yet</div>}</Card>
    </div>
    <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 10 }}>Recent Transactions</div><div style={{ maxHeight: 320, overflowY: 'auto' }}>{f.slice(0, 20).map(t => <TxRow key={t.id} t={t} showSplit={false} />)}</div>{!f.length && <div style={{ textAlign: 'center', padding: 24, color: T.td }}>Upload CSVs from Import to start</div>}</Card>

    {/* ── Investment Tracker ─────────────────────────────────────────────── */}
    {hasInvestments && <Card glow="#3b82f6">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>📈 Investments</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: T.mo, color: T.gn }}>{fmtK(totalInvBal)}</div>
          {totalGain !== 0 && <div style={{ fontSize: 11, fontFamily: T.mo, fontWeight: 600, color: totalGain >= 0 ? T.gn : T.rd }}>{totalGain >= 0 ? '+' : ''}{fmtK(totalGain)} gain</div>}
        </div>
      </div>

      {/* Monthly investment flow chart */}
      {invested > 0 && <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: T.td, marginBottom: 8 }}>Monthly Contributions</div>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={invRoll} barSize={8}>
            <XAxis dataKey="month" tick={{ fontSize: 8, fill: T.td }} tickLine={false} axisLine={false} />
            <Tooltip content={<Tip />} />
            <Bar dataKey="invested" name="Invested" fill="#3b82f6" radius={[3, 3, 0, 0]} opacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
      </div>}

      {/* Top positions (Fidelity) */}
      {fPositions.length > 0 && <div style={{ marginBottom: cbHoldings.length > 0 ? 14 : 0 }}>
        <div style={{ fontSize: 11, color: T.td, marginBottom: 6 }}>Top Holdings</div>
        {fPositions.slice(0, 5).map(p => {
          const pct = totalInvBal > 0 ? (p.currentVal / totalInvBal * 100) : 0;
          return <div key={p.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${T.bd}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, fontFamily: T.mo, color: p.isMM ? T.bl : T.gd, width: 48 }}>{p.symbol}</div>
            <div style={{ flex: 1 }}>
              <div style={{ height: 4, background: 'rgba(0,0,0,0.04)', borderRadius: 2 }}><div style={{ height: '100%', width: `${pct}%`, background: '#3b82f6', borderRadius: 2 }} /></div>
            </div>
            <div style={{ textAlign: 'right', minWidth: 70 }}>
              <div style={{ fontSize: 11, fontFamily: T.mo, fontWeight: 700, color: T.tx }}>{fmtD(p.currentVal)}</div>
              {p.totalGain !== 0 && <div style={{ fontSize: 9, fontFamily: T.mo, color: p.totalGain >= 0 ? T.gn : T.rd }}>{p.totalGain >= 0 ? '+' : ''}{fmtD(p.totalGain)}</div>}
            </div>
          </div>;
        })}
        {fPositions.length > 5 && <div style={{ fontSize: 10, color: T.td, textAlign: 'center', padding: '6px 0' }}>+{fPositions.length - 5} more — see Net Worth</div>}
      </div>}

      {/* Crypto holdings */}
      {cbHoldings.length > 0 && <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: T.td }}>Crypto</span>
          {coinbaseData?.live && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: `${T.gn}15`, color: T.gn }}>● LIVE</span>}
        </div>
        {cbHoldings.slice(0, 4).map(h => {
          const val = h.qty * h.price; const gain = val - h.cost;
          return <div key={h.asset} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${T.bd}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, fontFamily: T.mo, color: T.bl, width: 48 }}>{h.asset}</div>
            <div style={{ flex: 1, fontSize: 10, color: T.td }}>{h.qty.toFixed(4)} @ {fmtD(h.price)}</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontFamily: T.mo, fontWeight: 700, color: T.tx }}>{fmtD(val)}</div>
              {gain !== 0 && <div style={{ fontSize: 9, fontFamily: T.mo, color: gain >= 0 ? T.gn : T.rd }}>{gain >= 0 ? '+' : ''}{fmtD(gain)}</div>}
            </div>
          </div>;
        })}
      </div>}
    </Card>}
  </div>;
}

// ── TRANSACTIONS VIEW (with recategorize + split) ───────────────────────────
function TxView({ txns, period, setPeriod, onRecat, onSplit }) {
  const [q, setQ] = useState(''); const [cf, setCf] = useState('all');
  const f = useMemo(() => { let t = filtr(txns, period); if (q) t = t.filter(x => (x.desc || '').toLowerCase().includes(q.toLowerCase()) || (x.cat || '').toLowerCase().includes(q.toLowerCase())); if (cf !== 'all') t = t.filter(x => x.cat === cf); return t; }, [txns, period, q, cf]);
  const cats = useMemo(() => [...new Set(txns.map(t => t.cat))].filter(Boolean).sort(), [txns]);
  const { income, expenses, net, rate } = calcSum(f);
  const splitCount = txns.filter(t => t.splitOf).length;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Card style={{ padding: '12px 16px' }}><PeriodSel period={period} onChange={setPeriod} txns={txns} /></Card>
    <div className="fv-g4"><Stat label="Income" value={fmtK(income)} color={T.gn} /><Stat label="Spent" value={fmtK(expenses)} color={T.rd} /><Stat label="Net" value={fmtK(net)} color={net >= 0 ? T.gn : T.rd} /><Stat label="Rate" value={`${rate.toFixed(1)}%`} color={rate >= 20 ? T.gn : T.gd} sub={`${f.length} txns${splitCount > 0 ? ` · ${splitCount} splits` : ''}`} /></div>
    <Card style={{ padding: '10px 14px' }}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search transactions…" style={{ ...IS, flex: 1, minWidth: 140, padding: '7px 10px', fontSize: 12 }} /><select value={cf} onChange={e => setCf(e.target.value)} style={{ background: 'rgba(0,0,0,0.04)', border: `1px solid ${T.bdl}`, borderRadius: 8, padding: '7px 10px', color: T.tm, fontSize: 12, fontFamily: T.f, cursor: 'pointer' }}><option value="all">All Categories</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></div></Card>
    <Card><div style={{ fontSize: 11, color: T.td, marginBottom: 6 }}>Click category to recategorize · ✂ to split</div><div style={{ maxHeight: 500, overflowY: 'auto' }}>{f.map(t => <TxRow key={t.id} t={t} onRecat={onRecat} onSplit={onSplit} />)}</div>{!f.length && <div style={{ textAlign: 'center', padding: 24, color: T.td }}>No matches</div>}</Card>
  </div>;
}

// ── TRENDS VIEW ─────────────────────────────────────────────────────────────
function TrendsView({ txns }) {
  const [m, setM] = useState('net');
  const mo = useMemo(() => { const map = {}; txns.filter(t => !t.splitOf || true).forEach(t => { const mk = mkey(t.date); if (!mk) return; if (!map[mk]) map[mk] = { mk, income: 0, expenses: 0, invested: 0 }; if (t.amt > 0 && !['Investing', 'Transfer'].includes(t.cat)) map[mk].income += t.amt; if (t.amt < 0 && !['Investing', 'Transfer'].includes(t.cat)) map[mk].expenses += Math.abs(t.amt); if (t.cat === 'Investing' && t.amt < 0) map[mk].invested += Math.abs(t.amt); }); return Object.values(map).sort((a, b) => a.mk.localeCompare(b.mk)).map(d => { const [y, mn] = d.mk.split('-'); return { label: `${MTHS[parseInt(mn) - 1]} '${y.slice(2)}`, ...d, net: +(d.income - d.expenses).toFixed(0), rate: d.income > 0 ? +((d.income - d.expenses) / d.income * 100).toFixed(1) : 0 }; }); }, [txns]);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <Card><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}><div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>Trends</div><div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{[['net', 'Net'], ['income', 'Income'], ['expenses', 'Expenses'], ['rate', 'Rate']].map(([k, l]) => <Btn key={k} active={m === k} onClick={() => setM(k)}>{l}</Btn>)}</div></div>
      <ResponsiveContainer width="100%" height={220}>{m === 'rate' ? <AreaChart data={mo.slice(-18)}><defs><linearGradient id="rG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.ac} stopOpacity={0.3} /><stop offset="100%" stopColor={T.ac} stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="label" tick={{ fontSize: 9, fill: T.td }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 9, fill: T.td }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} /><Tooltip content={({ active, payload, label: l }) => active && payload?.length ? <div style={{ background: T.sf, border: `1px solid ${T.bdl}`, borderRadius: 8, padding: '8px 12px', fontFamily: T.f }}><div style={{ color: T.td, fontSize: 10 }}>{l}</div><div style={{ color: T.ac, fontFamily: T.mo, fontWeight: 700 }}>{payload[0].value}%</div></div> : null} /><Area type="monotone" dataKey="rate" stroke={T.ac} fill="url(#rG)" strokeWidth={2} dot={{ fill: T.ac, r: 3 }} /></AreaChart> : <BarChart data={mo.slice(-18)} barSize={10}><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="label" tick={{ fontSize: 9, fill: T.td }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 9, fill: T.td, fontFamily: T.mo }} tickLine={false} axisLine={false} tickFormatter={fmtK} /><Tooltip content={<Tip />} /><Bar dataKey={m} name={m} fill={m === 'income' ? T.gn : m === 'expenses' ? T.rd : T.ac} radius={[3, 3, 0, 0]} opacity={0.85} /></BarChart>}</ResponsiveContainer></Card>
    <Card><div style={{ fontSize: 12, fontWeight: 700, color: T.tx, marginBottom: 8 }}>Monthly Table</div><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['Month', 'Income', 'Expenses', 'Net', 'Invested', 'Rate'].map(h => <th key={h} style={{ textAlign: h === 'Month' ? 'left' : 'right', padding: '6px 4px', borderBottom: `1px solid ${T.bd}`, color: T.td, fontWeight: 500, fontSize: 10 }}>{h}</th>)}</tr></thead><tbody>{[...mo].reverse().map(d => <tr key={d.mk}><td style={{ padding: '5px 4px', fontWeight: 600, color: T.tx }}>{d.label}</td><td style={{ textAlign: 'right', color: T.gn, fontFamily: T.mo }}>{d.income > 0 ? fmtK(d.income) : '—'}</td><td style={{ textAlign: 'right', color: T.rd, fontFamily: T.mo }}>{d.expenses > 0 ? fmtK(d.expenses) : '—'}</td><td style={{ textAlign: 'right', color: d.net >= 0 ? T.gn : T.rd, fontFamily: T.mo, fontWeight: 700 }}>{fmtK(d.net)}</td><td style={{ textAlign: 'right', color: '#3b82f6', fontFamily: T.mo }}>{d.invested > 0 ? fmtK(d.invested) : '—'}</td><td style={{ textAlign: 'right', color: d.rate >= 20 ? T.gn : d.rate >= 0 ? T.gd : T.rd, fontFamily: T.mo, fontWeight: 700 }}>{d.income > 0 ? `${d.rate}%` : '—'}</td></tr>)}</tbody></table></div></Card>
  </div>;
}

// ── BUDGET VIEW ─────────────────────────────────────────────────────────────
function BudgetView({ txns, period, setPeriod, budgets, onBudget }) {
  const f = useMemo(() => filtr(txns, period), [txns, period]);
  const cs = {}; f.filter(t => t.amt < 0 && !['Investing', 'Transfer', 'Income'].includes(t.cat)).forEach(t => { cs[t.cat] = (cs[t.cat] || 0) + Math.abs(t.amt); });
  const rows = Object.entries(CATS).filter(([n]) => !['Investing', 'Income', 'Transfer'].includes(n)).map(([n, m]) => { const sp = cs[n] || 0; const b = budgets[n] || 0; return { n, ...m, sp, b, pct: b > 0 ? Math.min(sp / b * 100, 150) : 0, over: sp > b && b > 0 }; }).sort((a, b) => b.sp - a.sp);
  const tS = rows.reduce((s, r) => s + r.sp, 0); const tB = rows.reduce((s, r) => s + r.b, 0);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Card style={{ padding: '12px 16px' }}><PeriodSel period={period} onChange={setPeriod} txns={txns} /></Card>
    <div className="fv-g3"><Stat label="Budget" value={fmtK(tB)} color={T.gd} icon="🎯" /><Stat label="Spent" value={fmtK(tS)} color={tS > tB ? T.rd : T.gn} icon="💸" /><Stat label="Left" value={fmtK(tB - tS)} color={tB > tS ? T.gn : T.rd} icon={tB > tS ? '✅' : '⚠️'} /></div>
    <Card>{rows.map(r => <div key={r.n} style={{ marginBottom: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 14 }}>{r.icon}</span><span style={{ fontSize: 12, color: T.tx, fontWeight: 500 }}>{r.n}</span>{r.over && <Badge color={T.rd}>OVER</Badge>}</div><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12, color: r.over ? T.rd : T.tx, fontFamily: T.mo, fontWeight: 700 }}>{fmt(r.sp)}</span><span style={{ color: T.td }}>/</span><input type="number" value={r.b || ''} onChange={e => onBudget(r.n, parseFloat(e.target.value) || 0)} placeholder="—" style={{ width: 70, background: 'rgba(0,0,0,0.04)', border: `1px solid ${T.bdl}`, borderRadius: 6, padding: '4px 6px', color: T.tm, fontSize: 11, fontFamily: T.mo, outline: 'none', textAlign: 'right' }} /></div></div><div style={{ height: 5, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(r.pct, 100)}%`, background: r.over ? T.rd : r.color, borderRadius: 3, transition: 'width 0.3s' }} /></div></div>)}</Card>
  </div>;
}

// ── RECURRING VIEW ──────────────────────────────────────────────────────────
function RecurView({ recurring, dismissed, onDismiss, onUndo }) {
  const [showD, setShowD] = useState(false);
  const act = recurring.filter(r => r.active && !dismissed.includes(r.vendor));
  const inact = recurring.filter(r => !r.active && !dismissed.includes(r.vendor));
  const dis = recurring.filter(r => dismissed.includes(r.vendor));
  const tM = act.reduce((s, r) => s + (r.freq === 'monthly' ? r.amount : r.annual / 12), 0);
  const fL = f => ({ monthly: '/mo', quarterly: '/qtr', yearly: '/yr', biweekly: '/2wk', weekly: '/wk' }[f] || '');
  const fC = f => ({ monthly: T.ac, quarterly: T.bl, yearly: T.gd, biweekly: '#f97316', weekly: T.gn }[f] || T.td);
  const RC = ({ r, isD }) => { const m = CATS[r.cat] || CATS.Other; return <div style={{ padding: '12px 14px', borderRadius: T.rs, border: `1px solid ${T.bd}`, background: isD ? 'rgba(255,255,255,0.01)' : T.sf, marginBottom: 6, opacity: isD ? 0.5 : 1 }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 28, height: 28, borderRadius: 7, background: `${m.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{m.icon}</div><div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{r.name}</div><div style={{ display: 'flex', gap: 5, marginTop: 1 }}><Badge color={fC(r.freq)}>{r.freq}</Badge><span style={{ fontSize: 10, color: m.color }}>{r.cat}</span></div></div></div><div style={{ textAlign: 'right' }}><div style={{ fontSize: 14, fontWeight: 700, fontFamily: T.mo, color: T.tx }}>{fmtD(r.amount)}<span style={{ fontSize: 10, color: T.td }}>{fL(r.freq)}</span></div><div style={{ fontSize: 10, color: T.td }}>{fmtK(r.annual)}/yr</div></div></div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ fontSize: 10, color: T.td }}>Last: {r.lastDate} · Next: ~{r.nextDate}</div>{isD ? <button onClick={() => onUndo(r.vendor)} style={{ fontSize: 10, background: `${T.bl}15`, border: 'none', borderRadius: 5, padding: '2px 8px', color: T.bl, cursor: 'pointer', fontFamily: T.f }}>Restore</button> : <button onClick={() => onDismiss(r.vendor)} style={{ fontSize: 10, background: 'rgba(0,0,0,0.03)', border: 'none', borderRadius: 5, padding: '2px 8px', color: T.td, cursor: 'pointer', fontFamily: T.f }}>Not recurring</button>}</div></div>; };
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="fv-g3"><Stat label="Monthly Subs" value={fmtD(tM)} color={T.ac} icon="🔄" sub={`${act.length} active`} /><Stat label="Annual Cost" value={fmtK(tM * 12)} color={T.rd} icon="📅" /><Stat label="Daily" value={fmtD(tM * 12 / 365)} color={T.gd} icon="⏱️" /></div>
    {act.length === 0 && inact.length === 0 ? <Card style={{ textAlign: 'center', padding: 32 }}><div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div><div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 4 }}>No recurring detected</div><div style={{ fontSize: 12, color: T.tm }}>Import 3+ months of data for better detection.</div></Card> : <>
      {act.length > 0 && <Card><div style={{ fontSize: 12, fontWeight: 700, color: T.gn, marginBottom: 10 }}>Active ({act.length})</div>{act.map(r => <RC key={r.vendor} r={r} />)}</Card>}
      {inact.length > 0 && <Card><div style={{ fontSize: 12, fontWeight: 700, color: T.gd, marginBottom: 10 }}>Possibly Cancelled ({inact.length})</div>{inact.map(r => <RC key={r.vendor} r={r} />)}</Card>}
      {dis.length > 0 && <><button onClick={() => setShowD(s => !s)} style={{ fontSize: 11, background: 'none', border: 'none', color: T.td, cursor: 'pointer', fontFamily: T.f }}>{showD ? '▲ Hide' : '▼ Show'} {dis.length} dismissed</button>{showD && dis.map(r => <RC key={r.vendor} r={r} isD />)}</>}
    </>}
  </div>;
}

// ── RULES VIEW ──────────────────────────────────────────────────────────────
function RulesView({ rules, learnedRules, txns, onAdd, onDel, onApply, onDelLearned }) {
  const [pat, setPat] = useState(''); const [mt, setMt] = useState('contains'); const [cat, setCat] = useState('Groceries');
  const [msg, setMsg] = useState(null);
  const counts = useMemo(() => { const c = {}; rules.forEach((r, i) => { let n = 0; txns.forEach(t => { const d = (t.desc || '').toLowerCase(); try { if (r.matchType === 'contains' && d.includes(r.pattern.toLowerCase())) n++; else if (r.matchType === 'startsWith' && d.startsWith(r.pattern.toLowerCase())) n++; else if (r.matchType === 'exact' && d === r.pattern.toLowerCase()) n++; else if (r.matchType === 'regex' && new RegExp(r.pattern, 'i').test(d)) n++; } catch {} }); c[i] = n; }); return c; }, [rules, txns]);
  const preview = useMemo(() => { if (!pat.trim()) return []; const p = pat.toLowerCase(); return txns.filter(t => { const d = (t.desc || '').toLowerCase(); try { if (mt === 'contains') return d.includes(p); if (mt === 'startsWith') return d.startsWith(p); if (mt === 'exact') return d === p; if (mt === 'regex') return new RegExp(pat, 'i').test(d); } catch {} return false; }).slice(0, 6); }, [pat, mt, txns]);
  const otherN = txns.filter(t => t.cat === 'Other').length;
  const handleAdd = () => { if (!pat.trim()) return; onAdd({ pattern: pat.trim(), matchType: mt, category: cat }); setPat(''); setMsg(`Rule added! ${preview.length}+ transactions updated.`); setTimeout(() => setMsg(null), 3000); };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {otherN > 0 && <div style={{ padding: '12px 16px', borderRadius: T.rs, background: `${T.gd}10`, border: `1px solid ${T.gd}25` }}><div style={{ fontSize: 12, fontWeight: 600, color: T.gd }}>📌 {otherN} transactions are "Other"</div><div style={{ fontSize: 11, color: T.tm, marginTop: 2 }}>Create rules below or recategorize in Transactions to auto-learn.</div></div>}

    {learnedRules?.length > 0 && <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>🧠 Auto-Learned ({learnedRules.length})</div>
      </div>
      {learnedRules.map((r, i) => { const m = CATS[r.category] || CATS.Other; return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: 'rgba(129,140,248,0.04)', border: `1px solid ${T.bd}`, marginBottom: 4 }}><span style={{ fontSize: 12 }}>{m.icon}</span><div style={{ flex: 1 }}><span style={{ fontSize: 12, fontFamily: T.mo, color: T.tx }}>{r.pattern}</span><div style={{ fontSize: 10, color: T.td }}>→ {r.category} · from recategorization</div></div><button onClick={() => onDelLearned(i)} style={{ fontSize: 10, background: `${T.rd}12`, border: 'none', borderRadius: 5, padding: '3px 8px', color: T.rd, cursor: 'pointer', fontFamily: T.f }}>Del</button></div>; })}
    </Card>}

    <Card glow={T.ac}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Create a Rule</div>
      <div className="fv-g2" style={{ marginBottom: 10 }}>
        <div><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Match</label><select value={mt} onChange={e => setMt(e.target.value)} style={{ ...IS, padding: '7px 8px', fontSize: 11 }}><option value="contains">Contains</option><option value="startsWith">Starts with</option><option value="exact">Exact</option><option value="regex">Regex</option></select></div>
        <div><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Pattern</label><input value={pat} onChange={e => setPat(e.target.value)} placeholder={mt === 'regex' ? 'amzn.*mktp' : 'AMZN MKTP'} style={{ ...IS, padding: '7px 10px', fontSize: 11 }} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Category</label><select value={cat} onChange={e => setCat(e.target.value)} style={{ ...IS, padding: '7px 8px', fontSize: 11 }}>{Object.keys(CATS).filter(c => c !== 'Other').map(c => <option key={c} value={c}>{CATS[c].icon} {c}</option>)}</select></div>
        <button onClick={handleAdd} disabled={!pat.trim()} style={{ padding: '8px 16px', borderRadius: T.rs, border: 'none', cursor: pat.trim() ? 'pointer' : 'default', fontSize: 12, fontWeight: 700, fontFamily: T.f, background: pat.trim() ? T.ac : 'rgba(0,0,0,0.04)', color: pat.trim() ? '#fff' : T.td }}>Add</button>
      </div>
      {msg && <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: `${T.gn}15`, color: T.gn, fontSize: 11, fontWeight: 600 }}>✓ {msg}</div>}
      {preview.length > 0 && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: T.rs, background: 'rgba(0,0,0,0.02)', border: `1px solid ${T.bd}` }}><div style={{ fontSize: 10, color: T.ac, fontWeight: 600, marginBottom: 4 }}>Preview: {preview.length}+ matches</div>{preview.map(t => <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 10 }}><span style={{ color: T.tm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{t.desc}</span><div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}><span style={{ color: T.rd, textDecoration: 'line-through' }}>{t.cat}</span><span style={{ color: T.td }}>→</span><span style={{ color: CATS[cat]?.color, fontWeight: 600 }}>{cat}</span></div></div>)}</div>}
    </Card>

    {rules.length > 0 && <Card><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>Custom Rules ({rules.length})</div><button onClick={onApply} style={{ padding: '4px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: T.f, background: `${T.ac}22`, color: T.ac }}>↻ Re-apply all</button></div>
      {rules.map((r, i) => { const m = CATS[r.category] || CATS.Other; return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', border: `1px solid ${T.bd}`, marginBottom: 4 }}><span style={{ fontSize: 12 }}>{m.icon}</span><div style={{ flex: 1 }}><div style={{ display: 'flex', gap: 4, alignItems: 'center' }}><Badge color={T.td}>{r.matchType}</Badge><span style={{ fontSize: 12, fontFamily: T.mo, color: T.tx }}>{r.pattern}</span></div><div style={{ fontSize: 10, color: T.td }}>→ {r.category} · {counts[i] || 0} matches</div></div><button onClick={() => onDel(i)} style={{ fontSize: 10, background: `${T.rd}12`, border: 'none', borderRadius: 5, padding: '3px 8px', color: T.rd, cursor: 'pointer', fontFamily: T.f }}>Del</button></div>; })}
    </Card>}
  </div>;
}

// ── NET WORTH VIEW ──────────────────────────────────────────────────────────
function NetWorthView({ settings, history, onUpdateHistory, fidelityData, coinbaseData, balances, setBalances, accounts }) {
  const [ib, setIb] = useState(''); const [id, setId] = useState(new Date().toISOString().slice(0, 7));
  const ga = settings?.goalAmt || 0; const gd = settings?.goalDate || '';
  const sorted = useMemo(() => [...(history || [])].sort((a, b) => a.date.localeCompare(b.date)), [history]);
  const netWorth = Object.values(balances || {}).reduce((s, v) => s + v, 0);
  const latest = sorted.length > 0 ? sorted[sorted.length - 1].value : netWorth;
  const chartData = useMemo(() => { const pts = sorted.map(p => ({ label: `${MTHS[parseInt(p.date.split('-')[1]) - 1]} '${p.date.slice(2, 4)}`, date: p.date, actual: p.value })); if (ga > 0 && gd && sorted.length >= 2) { const first = sorted[0]; const last = sorted[sorted.length - 1]; const moE = (new Date(last.date + '-01') - new Date(first.date + '-01')) / (30.44 * 864e5); const mg = moE > 0 ? (last.value - first.value) / moE : 0; const target = new Date(gd); const moT = (target.getFullYear() - new Date(last.date + '-01').getFullYear()) * 12 + target.getMonth() - new Date(last.date + '-01').getMonth(); for (let i = 1; i <= Math.min(moT, 120); i++) { const d = new Date(last.date + '-01'); d.setMonth(d.getMonth() + i); const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; pts.push({ label: `${MTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, date: mk, projected: Math.round(last.value + mg * i) }); } } return pts; }, [sorted, ga, gd]);
  const pct = ga > 0 ? Math.min((latest / ga) * 100, 100) : 0;
  const projected = useMemo(() => { if (sorted.length < 2 || !gd) return null; const first = sorted[0]; const last = sorted[sorted.length - 1]; const moE = (new Date(last.date + '-01') - new Date(first.date + '-01')) / (30.44 * 864e5); if (moE <= 0) return null; const rate = (last.value - first.value) / moE; if (rate <= 0) return null; const moToGoal = ga > 0 ? (ga - last.value) / rate : 0; const arr = new Date(); arr.setMonth(arr.getMonth() + Math.ceil(moToGoal)); return { monthlyRate: rate, moToGoal: Math.ceil(moToGoal), arriveDate: arr.toISOString().slice(0, 7), onTrack: gd ? arr.toISOString().slice(0, 7) <= gd : false }; }, [sorted, ga, gd]);
  const handleAdd = () => { const val = parseFloat(ib); if (!val || !id) return; onUpdateHistory([...(history || []).filter(h => h.date !== id), { date: id, value: val }]); setIb(''); };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="fv-g3"><Stat label="Net Worth" value={fmtK(latest)} color={T.ac} icon="💎" />{ga > 0 && <Stat label="Goal" value={fmtK(ga)} color={T.gd} icon="🎯" sub={gd ? `by ${gd}` : ''} />}{projected && <Stat label="ETA" value={projected.arriveDate} color={projected.onTrack ? T.gn : T.rd} icon={projected.onTrack ? '✅' : '⏱️'} sub={`${fmtK(projected.monthlyRate)}/mo growth`} />}</div>
    {ga > 0 && <Card style={{ padding: '14px 18px' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}><span style={{ color: T.tm }}>Progress to {fmtK(ga)}</span><span style={{ color: T.ac, fontFamily: T.mo, fontWeight: 700 }}>{pct.toFixed(1)}%</span></div><div style={{ height: 10, background: 'rgba(0,0,0,0.04)', borderRadius: 5, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${T.ac}, #c084fc)`, borderRadius: 5 }} /></div>{projected && <div style={{ fontSize: 11, color: projected.onTrack ? T.gn : T.gd, marginTop: 6 }}>{projected.onTrack ? `On track — ~${projected.moToGoal} months ahead` : `At current pace: ~${projected.moToGoal} months (${projected.arriveDate})`}</div>}</Card>}
    {chartData.length > 1 && <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Net Worth Over Time</div><ResponsiveContainer width="100%" height={220}><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="label" tick={{ fontSize: 9, fill: T.td }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 9, fill: T.td, fontFamily: T.mo }} tickLine={false} axisLine={false} tickFormatter={fmtK} /><Tooltip content={({ active, payload, label: l }) => active && payload?.length ? <div style={{ background: T.sf, border: `1px solid ${T.bdl}`, borderRadius: 8, padding: '8px 12px', fontFamily: T.f }}><div style={{ color: T.td, fontSize: 10 }}>{l}</div>{payload.map((p, i) => p.value != null && <div key={i} style={{ color: p.color, fontFamily: T.mo, fontWeight: 700, fontSize: 12 }}>{p.name}: {fmtK(p.value)}</div>)}</div> : null} />{ga > 0 && <ReferenceLine y={ga} stroke={T.gd} strokeDasharray="5 5" />}<Line type="monotone" dataKey="actual" name="Actual" stroke={T.ac} strokeWidth={2.5} dot={{ fill: T.ac, r: 3.5 }} connectNulls /><Line type="monotone" dataKey="projected" name="Projected" stroke={T.gd} strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls /></ComposedChart></ResponsiveContainer></Card>}

    {/* ── Account Balances ── */}
    {(accounts || []).length > 0 && <Card>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Account Balances</div>
      {(accounts || []).map(acc => {
        const bal = balances?.[acc.id] || 0;
        const hasFid = acc.type === 'investment' && fidelityData;
        const hasCB = acc.type === 'crypto' && coinbaseData;
        return <div key={acc.id} style={{ borderRadius: 11, border: `1px solid ${T.bd}`, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 15px', background: 'rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${acc.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{acc.icon}</div>
              <div><div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{acc.label}</div><div style={{ fontSize: 9, color: T.td, textTransform: 'capitalize' }}>{acc.type}</div></div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {bal > 0 && <div style={{ fontSize: 14, fontWeight: 800, fontFamily: T.mo, color: T.gn }}>{fmtD(bal)}</div>}
              {!hasFid && !hasCB && <input type="number" defaultValue={bal || ''} placeholder="Balance" onBlur={e => { const v = parseFloat(e.target.value) || 0; setBalances(prev => { const u = { ...prev, [acc.id]: v }; ST.set('balances', u); return u; }); }} style={{ display: 'block', width: 110, marginTop: 3, background: 'rgba(0,0,0,0.04)', border: `1px solid ${T.bdl}`, borderRadius: 6, padding: '3px 8px', color: T.gn, fontSize: 11, fontFamily: T.mo, outline: 'none', textAlign: 'right' }} />}
            </div>
          </div>
          {/* Fidelity positions table */}
          {hasFid && <div style={{ borderTop: `1px solid ${T.bd}`, background: 'rgba(140,40,0,0.04)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 70px 70px 90px', gap: 4, padding: '5px 15px', borderBottom: `1px solid ${T.bd}`, fontSize: 9, color: T.td, textTransform: 'uppercase', letterSpacing: '0.06em' }}><div>Sym</div><div>Name</div><div style={{ textAlign: 'right' }}>Qty</div><div style={{ textAlign: 'right' }}>Price</div><div style={{ textAlign: 'right' }}>Value</div></div>
            {Object.values(fidelityData.accounts).flatMap(a => a.positions).sort((a, b) => b.currentVal - a.currentVal).map(p => <div key={p.symbol} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 70px 70px 90px', gap: 4, padding: '7px 15px', borderBottom: `1px solid ${T.bd}`, alignItems: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 800, fontFamily: T.mo, color: p.isMM ? T.bl : T.gd }}>{p.symbol}</div>
              <div style={{ fontSize: 10, color: T.tm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>
              <div style={{ textAlign: 'right', fontSize: 10, fontFamily: T.mo, color: T.tm }}>{p.quantity > 0 ? p.quantity.toFixed(3) : '—'}</div>
              <div style={{ textAlign: 'right', fontSize: 10, fontFamily: T.mo, color: T.tm }}>{p.lastPrice > 0 ? fmtD(p.lastPrice) : '—'}</div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, fontWeight: 700, fontFamily: T.mo, color: T.gn }}>{fmtD(p.currentVal)}</div>{p.totalGain !== 0 && <div style={{ fontSize: 9, color: p.totalGain >= 0 ? T.gn : T.rd, fontFamily: T.mo }}>{p.totalGain >= 0 ? '+' : ''}{fmtD(p.totalGain)}</div>}</div>
            </div>)}
            <div style={{ padding: '6px 15px', display: 'flex', justifyContent: 'space-between', fontSize: 10 }}><span style={{ color: T.td }}>Total Gain/Loss</span><span style={{ fontFamily: T.mo, fontWeight: 700, color: T.gn }}>{fmtD(Object.values(fidelityData.accounts).flatMap(a => a.positions).reduce((s, p) => s + p.totalGain, 0))}</span></div>
          </div>}
          {/* Coinbase holdings table */}
          {hasCB && <div style={{ borderTop: `1px solid rgba(0,82,255,0.15)`, background: 'rgba(0,82,255,0.03)' }}>
            <div style={{ display: 'flex', gap: 14, padding: '6px 15px', borderBottom: `1px solid ${T.bd}`, fontSize: 10, flexWrap: 'wrap' }}>
              <span style={{ color: T.td }}>Cost <span style={{ color: T.tm, fontFamily: T.mo }}>{fmtD(coinbaseData.totalCost)}</span></span>
              <span style={{ color: T.td }}>Gain <span style={{ color: coinbaseData.gain >= 0 ? T.gn : T.rd, fontFamily: T.mo }}>{coinbaseData.gain >= 0 ? '+' : ''}{fmtD(coinbaseData.gain)}</span></span>
              <span style={{ marginLeft: 'auto', fontSize: 9, padding: '1px 6px', borderRadius: 8, background: coinbaseData.live ? `${T.gn}15` : 'rgba(0,0,0,0.04)', color: coinbaseData.live ? T.gn : T.td }}>{coinbaseData.live ? '● LIVE' : '○ CSV price'}</span>
            </div>
            {coinbaseData.holdings.map(h => { const val = h.qty * h.price; const gain = val - h.cost; return <div key={h.asset} style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 10, padding: '8px 15px', borderBottom: `1px solid ${T.bd}` }}>
              <div style={{ fontWeight: 800, fontFamily: T.mo, fontSize: 12, color: T.bl }}>{h.asset}</div>
              <div><div style={{ fontSize: 11, fontFamily: T.mo, color: T.tm }}>{h.qty.toFixed(6)}</div>{h.earned > 0 && <div style={{ fontSize: 9, color: T.td }}>+{h.earned.toFixed(6)} staked</div>}{h.price > 0 && <div style={{ fontSize: 9, color: T.td }}>@ {fmtD(h.price)}/unit</div>}</div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12, fontWeight: 700, fontFamily: T.mo, color: T.gn }}>{fmtD(val)}</div>{gain !== 0 && <div style={{ fontSize: 9, fontFamily: T.mo, color: gain >= 0 ? T.gn : T.rd }}>{gain >= 0 ? '+' : ''}{fmtD(gain)}</div>}</div>
            </div>; })}
          </div>}
        </div>;
      })}
    </Card>}

    <Card glow={T.ac}><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Record Snapshot</div><div style={{ fontSize: 11, color: T.td, marginBottom: 12 }}>Add your total net worth for any month. More data = better projections.</div><div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}><div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Month</label><input type="month" value={id} onChange={e => setId(e.target.value)} style={{ ...IS, colorScheme: 'light', fontSize: 12, padding: '8px 10px' }} /></div><div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Balance ($)</label><input type="number" value={ib} onChange={e => setIb(e.target.value)} placeholder="117319" style={{ ...IS, fontSize: 12, padding: '8px 10px' }} /></div><button onClick={handleAdd} style={{ padding: '9px 18px', borderRadius: T.rs, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: T.f, background: T.ac, color: '#fff', whiteSpace: 'nowrap' }}>Add</button></div></Card>
    {sorted.length > 0 && <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 10 }}>History</div>{sorted.map((p, i) => { const prev = i > 0 ? sorted[i - 1].value : null; const delta = prev ? p.value - prev : null; return <div key={p.date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.bd}` }}><span style={{ fontSize: 12, color: T.tm }}>{`${MTHS[parseInt(p.date.split('-')[1]) - 1]} ${p.date.slice(0, 4)}`}</span><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{delta !== null && <span style={{ fontSize: 10, color: delta >= 0 ? T.gn : T.rd, fontWeight: 600 }}>{delta >= 0 ? '+' : ''}{fmtK(delta)}</span>}<span style={{ fontFamily: T.mo, fontWeight: 700, fontSize: 12, color: T.tx }}>{fmtK(p.value)}</span><button onClick={() => onUpdateHistory((history || []).filter(h => h.date !== p.date))} style={{ fontSize: 9, background: `${T.rd}12`, border: 'none', borderRadius: 4, padding: '2px 6px', color: T.rd, cursor: 'pointer' }}>✕</button></div></div>; })}</Card>}
  </div>;
}

// ── INSIGHTS VIEW ───────────────────────────────────────────────────────────
function InsightsView({ txns, period }) {
  const f = useMemo(() => filtr(txns, period), [txns, period]);
  const { income, expenses } = calcSum(f);
  const isMo = /^\d{4}-\d{2}$/.test(period);
  const dIP = useMemo(() => { if (!isMo) return 30; const [y, m] = period.split('-').map(Number); return new Date(y, m, 0).getDate(); }, [period, isMo]);
  const dP = useMemo(() => { if (!isMo) return dIP; const now = new Date(); const [y, m] = period.split('-').map(Number); if (now.getFullYear() === y && now.getMonth() + 1 === m) return now.getDate(); return dIP; }, [period, isMo, dIP]);
  const avg3 = useMemo(() => { const now = new Date(); const mks = []; for (let i = 1; i <= 3; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); mks.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); } const pts = mks.map(mk => calcSum(txns.filter(t => mkey(t.date) === mk))); if (!pts.length) return null; return { income: pts.reduce((s, p) => s + p.income, 0) / pts.length, expenses: pts.reduce((s, p) => s + p.expenses, 0) / pts.length }; }, [txns]);
  const vendors = useMemo(() => { const map = {}; f.filter(t => t.amt < 0 && !['Transfer', 'Investing'].includes(t.cat)).forEach(t => { const v = normVendor(t.desc); if (!v || v.length < 3) return; if (!map[v]) map[v] = { name: t.desc.slice(0, 30), total: 0, count: 0, cat: t.cat }; map[v].total += Math.abs(t.amt); map[v].count++; }); return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10); }, [f]);
  const catCmp = useMemo(() => { if (!avg3) return []; const now = new Date(); const mks3 = []; for (let i = 1; i <= 3; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); mks3.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); } const ac = {}; mks3.forEach(mk => { txns.filter(t => mkey(t.date) === mk && t.amt < 0 && !['Transfer', 'Investing'].includes(t.cat)).forEach(t => { ac[t.cat] = (ac[t.cat] || 0) + Math.abs(t.amt); }); }); Object.keys(ac).forEach(k => ac[k] /= 3); const cc = {}; f.filter(t => t.amt < 0 && !['Transfer', 'Investing'].includes(t.cat)).forEach(t => { cc[t.cat] = (cc[t.cat] || 0) + Math.abs(t.amt); }); return [...new Set([...Object.keys(ac), ...Object.keys(cc)])].map(cat => ({ cat, curr: cc[cat] || 0, avg: ac[cat] || 0, delta: (ac[cat] || 0) > 0 ? ((cc[cat] || 0) - (ac[cat] || 0)) / (ac[cat] || 1) * 100 : 0 })).filter(c => c.curr > 0 || c.avg > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)); }, [f, txns, avg3]);
  const biggest = useMemo(() => f.filter(t => t.amt < 0 && !['Transfer', 'Investing'].includes(t.cat)).sort((a, b) => a.amt - b.amt)[0], [f]);
  const cpd = expenses / (dP || 1); const pm = cpd * dIP;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="fv-g4"><Stat label="Daily Spend" value={fmtD(cpd)} color={T.ac} icon="📅" sub={`${dP} days tracked`} /><Stat label="Projected Month" value={fmtK(pm)} color={pm > income ? T.rd : T.gn} icon="📈" sub={pm > income ? 'Over budget pace' : 'Under income'} />{avg3 && <Stat label="vs 3mo Avg" value={`${expenses > avg3.expenses ? '+' : ''}${((expenses - avg3.expenses) / (avg3.expenses || 1) * 100).toFixed(0)}%`} color={expenses > avg3.expenses ? T.rd : T.gn} icon={expenses > avg3.expenses ? '📈' : '📉'} sub={`Avg: ${fmtK(avg3.expenses)}`} />}{biggest && <Stat label="Biggest" value={fmtD(Math.abs(biggest.amt))} color={T.rd} icon="🔥" sub={biggest.desc.slice(0, 25)} />}</div>
    {catCmp.length > 0 && <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Spending vs 3-Month Average</div>{catCmp.filter(c => Math.abs(c.delta) > 5).slice(0, 8).map(c => { const meta = CATS[c.cat] || CATS.Other; const up = c.delta > 0; return <div key={c.cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.bd}` }}><span style={{ fontSize: 15, width: 24, textAlign: 'center' }}>{meta.icon}</span><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 500, color: T.tx }}>{c.cat}</div><div style={{ fontSize: 10, color: T.td }}>3mo avg: {fmtK(c.avg)}</div></div><div style={{ textAlign: 'right' }}><div style={{ fontSize: 12, fontFamily: T.mo, fontWeight: 700, color: T.tx }}>{fmtK(c.curr)}</div><span style={{ fontSize: 10, fontWeight: 700, color: up ? T.rd : T.gn }}>{up ? '↑' : '↓'} {Math.abs(c.delta).toFixed(0)}%</span></div></div>; })}</Card>}
    {vendors.length > 0 && <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Top Merchants</div>{vendors.map((v, i) => { const meta = CATS[v.cat] || CATS.Other; return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${T.bd}` }}><span style={{ fontSize: 12, color: T.td, fontFamily: T.mo, width: 20, textAlign: 'right' }}>#{i + 1}</span><span style={{ fontSize: 14 }}>{meta.icon}</span><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 500, color: T.tx }}>{v.name}</div><div style={{ fontSize: 10, color: T.td }}>{v.count} charges · {fmtK(v.total / v.count * 12)}/yr est</div></div><span style={{ fontFamily: T.mo, fontWeight: 700, fontSize: 12, color: T.tx }}>{fmtD(v.total)}</span></div>; })}</Card>}
  </div>;
}

// ── CASH FLOW FORECAST ──────────────────────────────────────────────────────
function CashFlowView({ txns, recurring, settings }) {
  const [sb, setSb] = useState('');
  const balance = parseFloat(sb) || (settings?.netWorthHistory?.length > 0 ? settings.netWorthHistory[settings.netWorthHistory.length - 1]?.value : 0) || 0;
  const moData = useMemo(() => { const map = {}; txns.forEach(t => { const mk = mkey(t.date); if (!mk) return; if (!map[mk]) map[mk] = { income: 0, expenses: 0 }; if (t.amt > 0 && !['Investing', 'Transfer'].includes(t.cat)) map[mk].income += t.amt; if (t.amt < 0 && !['Investing', 'Transfer'].includes(t.cat)) map[mk].expenses += Math.abs(t.amt); }); const vals = Object.values(map); if (!vals.length) return { avgIncome: 0, avgExpenses: 0 }; return { avgIncome: vals.reduce((s, v) => s + v.income, 0) / vals.length, avgExpenses: vals.reduce((s, v) => s + v.expenses, 0) / vals.length }; }, [txns]);
  const upcoming = useMemo(() => { const n = new Date(); const co = new Date(n); co.setDate(co.getDate() + 30); return recurring.filter(r => r.active).map(r => { const next = new Date(r.nextDate); if (next >= n && next <= co) return { ...r, daysUntil: Math.round((next - n) / 864e5) }; return null; }).filter(Boolean).sort((a, b) => a.daysUntil - b.daysUntil); }, [recurring]);
  const tU = upcoming.reduce((s, r) => s + r.amount, 0);
  const forecast = useMemo(() => { const pts = []; let bal = balance; for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); if (i > 0) bal += moData.avgIncome - moData.avgExpenses; pts.push({ label: `${MTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, balance: Math.round(bal), income: Math.round(moData.avgIncome), expenses: Math.round(moData.avgExpenses) }); } return pts; }, [balance, moData, now]);
  const velocity = useMemo(() => { const thisMo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; const mt = txns.filter(t => mkey(t.date) === thisMo && t.amt < 0 && !['Transfer', 'Investing'].includes(t.cat)); const dIn = now.getDate(); const total = mt.reduce((s, t) => s + Math.abs(t.amt), 0); const dL = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - dIn; return { spent: total, perDay: total / (dIn || 1), daysLeft: dL, projected: (total / (dIn || 1)) * (dIn + dL) }; }, [txns, now]);
  const aB = balance - tU;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="fv-g4"><Stat label="Available" value={fmtK(balance)} color={T.ac} icon="💵" sub="Starting balance" /><Stat label="After Bills" value={fmtK(aB)} color={aB > 0 ? T.gn : T.rd} icon={aB > 0 ? '✅' : '⚠️'} sub={`${upcoming.length} bills in 30d`} /><Stat label="Daily Burn" value={fmtD(velocity.perDay)} color={T.gd} icon="🔥" sub={`${velocity.daysLeft} days left`} /><Stat label="Month-end" value={fmtK(balance + moData.avgIncome - velocity.projected)} color={T.bl} icon="📊" sub={`Est. spend: ${fmtK(velocity.projected)}`} /></div>
    <Card style={{ padding: '14px 18px' }}><div style={{ fontSize: 12, color: T.td, marginBottom: 6 }}>Set current checking balance for better forecasts:</div><input type="number" value={sb} onChange={e => setSb(e.target.value)} placeholder="Enter current balance" style={{ ...IS, flex: 1, fontSize: 12, padding: '8px 12px' }} /></Card>
    {upcoming.length > 0 && <Card><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>Upcoming Bills (30d)</div><span style={{ fontFamily: T.mo, fontWeight: 700, color: T.rd, fontSize: 13 }}>{fmtD(tU)}</span></div>{upcoming.map(r => { const meta = CATS[r.cat] || CATS.Other; return <div key={r.vendor} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.bd}` }}><div style={{ width: 30, height: 30, borderRadius: 7, background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{meta.icon}</div><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 500, color: T.tx }}>{r.name}</div><div style={{ fontSize: 10, color: T.td }}>~{r.nextDate} · {r.daysUntil === 0 ? 'Today' : `in ${r.daysUntil}d`}</div></div><span style={{ fontFamily: T.mo, fontWeight: 700, fontSize: 12, color: T.rd }}>{fmtD(r.amount)}</span></div>; })}</Card>}
    <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>6-Month Forecast</div><ResponsiveContainer width="100%" height={200}><ComposedChart data={forecast}><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="label" tick={{ fontSize: 9, fill: T.td }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 9, fill: T.td, fontFamily: T.mo }} tickLine={false} axisLine={false} tickFormatter={fmtK} /><Tooltip content={<Tip />} /><Bar dataKey="income" name="Income" fill={T.gn} radius={[3, 3, 0, 0]} opacity={0.4} barSize={14} /><Bar dataKey="expenses" name="Expenses" fill={T.rd} radius={[3, 3, 0, 0]} opacity={0.4} barSize={14} /><Line type="monotone" dataKey="balance" name="Balance" stroke={T.ac} strokeWidth={2.5} dot={{ fill: T.ac, r: 4 }} /></ComposedChart></ResponsiveContainer><div style={{ fontSize: 10, color: T.td, marginTop: 8 }}>Based on avg income ({fmtK(moData.avgIncome)}) and expenses ({fmtK(moData.avgExpenses)})</div></Card>
  </div>;
}

// ── EXPORT VIEW ─────────────────────────────────────────────────────────────
function ExportView({ txns, period, settings, recurring }) {
  const f = useMemo(() => filtr(txns, period), [txns, period]);
  const { income, expenses, invested, net, rate } = calcSum(f);
  const label = pLabel(period);
  const catSpend = {}; f.filter(t => t.amt < 0 && !['Investing', 'Transfer'].includes(t.cat)).forEach(t => { catSpend[t.cat] = (catSpend[t.cat] || 0) + Math.abs(t.amt); }); const catRows = Object.entries(catSpend).sort((a, b) => b[1] - a[1]);
  const topV = useMemo(() => { const map = {}; f.filter(t => t.amt < 0 && !['Transfer', 'Investing'].includes(t.cat)).forEach(t => { const v = normVendor(t.desc); if (!v || v.length < 3) return; if (!map[v]) map[v] = { name: t.desc.slice(0, 35), total: 0, count: 0 }; map[v].total += Math.abs(t.amt); map[v].count++; }); return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10); }, [f]);
  const gen = () => { const L = [`# FinView Report — ${label}`, `Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, '', '---', '', '## Summary', '', '| Metric | Amount |', '|---|---|', `| Income | ${fmtD(income)} |`, `| Expenses | ${fmtD(expenses)} |`, `| Net Saved | ${fmtD(net)} |`, `| Invested | ${fmtD(invested)} |`, `| Savings Rate | ${rate.toFixed(1)}% |`, `| Transactions | ${f.length} |`, '', '## Spending by Category', '', '| Category | Amount | % |', '|---|---|---|', ...catRows.map(([cat, amt]) => `| ${CATS[cat]?.icon || '📌'} ${cat} | ${fmtD(amt)} | ${(amt / expenses * 100).toFixed(1)}% |`), '', '## Top Merchants', '', '| # | Merchant | Amount | Count |', '|---|---|---|---|', ...topV.map((v, i) => `| ${i + 1} | ${v.name} | ${fmtD(v.total)} | ${v.count} |`)]; const actR = recurring.filter(r => r.active); if (actR.length > 0) { const mS = actR.reduce((s, r) => s + (r.freq === 'monthly' ? r.amount : r.annual / 12), 0); L.push('', '## Recurring', '', `Monthly: ${fmtD(mS)} · Annual: ${fmtD(mS * 12)}`, '', '| Service | Amt | Freq | Annual |', '|---|---|---|---|', ...actR.map(r => `| ${r.name} | ${fmtD(r.amount)} | ${r.freq} | ${fmtD(r.annual)} |`)); } L.push('', '---', '*Generated by FinView*'); const blob = new Blob([L.join('\n')], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `finview-report-${period || 'all'}.md`; a.click(); URL.revokeObjectURL(url); };
  const expCSV = () => { const h = 'Date,Description,Category,Amount,Account,SplitOf'; const rows = f.map(t => `${t.date},"${(t.desc || '').replace(/"/g, '""')}",${t.cat},${t.amt},${t.acc},${t.splitOf || ''}`); const blob = new Blob([h + '\n' + rows.join('\n')], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `finview-txns-${period || 'all'}.csv`; a.click(); URL.revokeObjectURL(url); };
  const expJSON = () => { const data = { exported: new Date().toISOString(), period: label, summary: { income, expenses, invested, net, savingsRate: rate }, transactions: f, recurring: recurring.filter(r => r.active), settings: { goal: settings?.goal, goalAmount: settings?.goalAmt, learnedRules: settings?.learnedRules?.length, customRules: settings?.customRules?.length } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `finview-data-${period || 'all'}.json`; a.click(); URL.revokeObjectURL(url); };
  const BS = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: T.rs, border: `1px solid ${T.bdl}`, background: 'rgba(0,0,0,0.02)', cursor: 'pointer', textAlign: 'left', width: '100%' };
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
    <Card glow={T.ac}><div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 4 }}>Export & Reports</div><div style={{ fontSize: 12, color: T.td, marginBottom: 16 }}>Generate for {label} ({f.length} txns)</div><div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><button onClick={gen} style={BS}><span style={{ fontSize: 24 }}>📄</span><div><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: T.f }}>Monthly Report (.md)</div><div style={{ fontSize: 11, color: T.td, fontFamily: T.f }}>Summary, categories, merchants, recurring</div></div></button><button onClick={expCSV} style={BS}><span style={{ fontSize: 24 }}>📊</span><div><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: T.f }}>Transactions (.csv)</div><div style={{ fontSize: 11, color: T.td, fontFamily: T.f }}>Spreadsheet format for Excel/Sheets</div></div></button><button onClick={expJSON} style={BS}><span style={{ fontSize: 24 }}>🗂️</span><div><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: T.f }}>Full Backup (.json)</div><div style={{ fontSize: 11, color: T.td, fontFamily: T.f }}>All data including rules and settings</div></div></button></div></Card>
    <Card><div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 10 }}>Preview — {label}</div><div className="fv-g2" style={{ marginBottom: 12 }}><div style={{ padding: '10px', borderRadius: 8, background: `${T.gn}10` }}><div style={{ fontSize: 10, color: T.gn }}>Income</div><div style={{ fontSize: 16, fontWeight: 700, fontFamily: T.mo, color: T.gn }}>{fmtK(income)}</div></div><div style={{ padding: '10px', borderRadius: 8, background: `${T.rd}10` }}><div style={{ fontSize: 10, color: T.rd }}>Expenses</div><div style={{ fontSize: 16, fontWeight: 700, fontFamily: T.mo, color: T.rd }}>{fmtK(expenses)}</div></div></div>{catRows.slice(0, 6).map(([cat, amt]) => { const m = CATS[cat] || CATS.Other; const pct = expenses > 0 ? (amt / expenses * 100) : 0; return <div key={cat} style={{ marginBottom: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 11 }}><span style={{ color: T.tm }}>{m.icon} {cat}</span><span style={{ fontFamily: T.mo, color: T.tx, fontWeight: 600 }}>{fmtD(amt)}</span></div><div style={{ height: 5, background: 'rgba(0,0,0,0.04)', borderRadius: 3 }}><div style={{ height: '100%', width: `${pct}%`, background: m.color, borderRadius: 3 }} /></div></div>; })}</Card>
  </div>;
}

// ── IMPORT VIEW ─────────────────────────────────────────────────────────────
function ImportView({ accounts, onImport, onClear, onAddAccount, onRemoveAccount, loading, err }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newAcc, setNewAcc] = useState({ label: '', type: 'checking' });

  const handleAdd = () => {
    if (!newAcc.label.trim()) return;
    const typeInfo = ACCT_TYPES.find(t => t.value === newAcc.type);
    onAddAccount({ label: newAcc.label.trim(), type: newAcc.type, icon: typeInfo?.icon || '🏦', color: ACCT_COLORS[accounts.length % ACCT_COLORS.length] });
    setNewAcc({ label: '', type: 'checking' }); setShowAdd(false);
  };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
    {/* Existing accounts */}
    {accounts.map(a => <Card key={a.id} glow={a.loaded ? a.color : null} style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 24, width: 36, textAlign: 'center' }}>{a.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: a.loaded ? a.color : T.tx }}>{a.label}</div>
          <div style={{ fontSize: 10, color: T.td, marginTop: 1 }}>
            {a.loaded ? `✓ ${a.count > 0 ? a.count + ' txns imported' : 'loaded'}` : 'No data — upload any CSV'}
          </div>
          <div style={{ fontSize: 9, color: T.td, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>
            {a.type === 'credit' ? '💳 Credit Card' : a.type === 'investment' ? '📈 Investment' : a.type === 'crypto' ? '₿ Crypto' : '🏦 Checking / Savings'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <label style={{ padding: '6px 14px', borderRadius: 16, background: a.loaded ? `${a.color}22` : 'rgba(0,0,0,0.04)', color: a.loaded ? a.color : T.tm, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: T.f }}>
            {loading === a.id ? '⏳' : a.loaded ? 'Update' : 'Upload CSV'}
            <input type="file" accept=".csv,.CSV" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) onImport(e.target.files[0], a.id); e.target.value = ''; }} />
          </label>
          {a.loaded && <button onClick={() => onClear(a.id)} style={{ padding: '6px 10px', borderRadius: 16, border: 'none', background: `${T.rd}08`, color: T.rd, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: T.f }}>Clear</button>}
          {!a.loaded && <button onClick={() => onRemoveAccount(a.id)} style={{ padding: '6px 10px', borderRadius: 16, border: 'none', background: `${T.rd}08`, color: T.rd, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: T.f }}>✕</button>}
        </div>
      </div>
    </Card>)}

    {/* Add Account */}
    {showAdd ? <Card glow={T.ac} style={{ padding: '16px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Add Account</div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 4 }}>Account Name</label>
        <input value={newAcc.label} onChange={e => setNewAcc(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Chase Sapphire, Ally Savings, Vanguard…" style={IS} autoFocus />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 4 }}>Account Type</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ACCT_TYPES.map(t => <button key={t.value} onClick={() => setNewAcc(p => ({ ...p, type: t.value }))}
            style={{ padding: '7px 14px', borderRadius: 10, border: newAcc.type === t.value ? `2px solid ${T.ac}` : `1px solid ${T.bdl}`, background: newAcc.type === t.value ? `${T.ac}15` : 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: T.f, color: newAcc.type === t.value ? T.ac : T.tm }}>
            {t.icon} {t.label}
          </button>)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleAdd} style={{ flex: 1, padding: '9px', borderRadius: T.rs, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: T.f, background: T.ac, color: '#fff' }}>Add Account</button>
        <button onClick={() => setShowAdd(false)} style={{ padding: '9px 16px', borderRadius: T.rs, border: `1px solid ${T.bdl}`, cursor: 'pointer', fontSize: 12, fontFamily: T.f, background: 'transparent', color: T.tm }}>Cancel</button>
      </div>
    </Card> : <button onClick={() => setShowAdd(true)} style={{ padding: '14px', borderRadius: T.r, border: `2px dashed ${T.bdl}`, background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: T.f, color: T.ac }}>+ Add Account</button>}

    {err && <div style={{ padding: '10px 14px', background: `${T.rd}10`, border: `1px solid ${T.rd}33`, borderRadius: T.rs, color: T.rd, fontSize: 11 }}>⚠ {err}</div>}

    {/* Universal help guide */}
    <Card style={{ background: 'rgba(0,0,0,0.015)', border: `1px solid ${T.bd}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.tx, marginBottom: 8 }}>How It Works</div>
      <div style={{ fontSize: 11, color: T.td, lineHeight: 1.8 }}>
        <div style={{ marginBottom: 6 }}>FinView auto-detects your CSV format. Just export a transaction CSV from your bank or brokerage and upload it — no manual configuration needed.</div>
        <div><b style={{ color: T.tm }}>Checking / Savings:</b> Download transactions as CSV from your bank</div>
        <div><b style={{ color: T.tm }}>Credit Cards:</b> Download activity/statements as CSV (Chase, AMEX, Citi, etc.)</div>
        <div><b style={{ color: T.tm }}>Investments:</b> Download positions CSV for portfolio tracking</div>
        <div><b style={{ color: T.tm }}>Crypto:</b> Export transaction history CSV (Coinbase, Kraken, etc.)</div>
        <div style={{ marginTop: 6, fontSize: 10, color: T.td, opacity: 0.7 }}>Supported: Chase, AMEX, Citi, Capital One, TD, Wells Fargo, Bank of America, Schwab, Fidelity, Vanguard, Coinbase, and any CSV with date + description + amount columns.</div>
      </div>
    </Card>
  </div>;
}

// ── SETTINGS VIEW ───────────────────────────────────────────────────────────
function SettingsView({ settings, onSave, onReset }) {
  const [s, setS] = useState({ ...settings }); const up = (k, v) => setS(p => ({ ...p, [k]: v }));
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
    <Card glow={T.ac}><div style={{ fontSize: 15, fontWeight: 700, color: T.tx, marginBottom: 14 }}>Profile</div><div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Name</label><input value={s.name} onChange={e => up('name', e.target.value)} style={IS} /></div><div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Goal</label><input value={s.goal || ''} onChange={e => up('goal', e.target.value)} style={IS} /></div><div className="fv-g2"><div><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Target ($)</label><input type="number" value={s.goalAmt || ''} onChange={e => up('goalAmt', parseFloat(e.target.value) || 0)} style={IS} /></div><div><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Target date</label><input type="date" value={s.goalDate || ''} onChange={e => up('goalDate', e.target.value)} style={{ ...IS, colorScheme: 'light' }} /></div></div></Card>
    <Card><div style={{ fontSize: 15, fontWeight: 700, color: T.tx, marginBottom: 14 }}>Rent & Filters</div><div className="fv-g2" style={{ marginBottom: 12 }}><div><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Full rent</label><input type="number" value={s.rentFull || ''} onChange={e => up('rentFull', parseFloat(e.target.value) || 0)} style={IS} /></div><div><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Your share</label><input type="number" value={s.rentShare || ''} onChange={e => up('rentShare', parseFloat(e.target.value) || 0)} style={IS} /></div></div><div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Roommates</label><input value={s.roommates || ''} onChange={e => up('roommates', e.target.value)} style={IS} /></div><div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Transfer keywords (skip)</label><textarea value={s.transferKeywords || ''} onChange={e => up('transferKeywords', e.target.value)} rows={2} style={{ ...IS, resize: 'vertical' }} /></div><div><label style={{ fontSize: 11, color: T.td, display: 'block', marginBottom: 4 }}>Investment keywords</label><textarea value={s.investKeywords || ''} onChange={e => up('investKeywords', e.target.value)} rows={2} style={{ ...IS, resize: 'vertical' }} /></div></Card>
    <div style={{ display: 'flex', gap: 8 }}><button onClick={() => onSave(s)} style={{ flex: 2, padding: '11px', borderRadius: T.rs, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: T.f, background: T.ac, color: '#fff' }}>Save</button><button onClick={onReset} style={{ flex: 1, padding: '11px', borderRadius: T.rs, border: `1px solid ${T.rd}44`, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: T.f, background: `${T.rd}10`, color: T.rd }}>Reset All</button></div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE 1: FINANCIAL HEALTH SCORE
// ═══════════════════════════════════════════════════════════════════════════
function calcHealthScore(txns, settings, recurring, balances) {
  const months = {};
  txns.forEach(t => {
    const mk = mkey(t.date); if (!mk) return;
    if (!months[mk]) months[mk] = { income: 0, expenses: 0, invested: 0 };
    if (t.amt > 0 && !['Investing', 'Transfer'].includes(t.cat)) months[mk].income += t.amt;
    if (t.amt < 0 && !['Investing', 'Transfer'].includes(t.cat)) months[mk].expenses += Math.abs(t.amt);
    if (t.cat === 'Investing' && t.amt < 0) months[mk].invested += Math.abs(t.amt);
  });
  const mKeys = Object.keys(months).sort().slice(-6);
  if (mKeys.length < 2) return null;
  const recent = mKeys.map(k => months[k]);
  const avgInc = recent.reduce((s, m) => s + m.income, 0) / recent.length;
  const avgExp = recent.reduce((s, m) => s + m.expenses, 0) / recent.length;
  const avgInv = recent.reduce((s, m) => s + m.invested, 0) / recent.length;

  // 1. Savings Rate (0-25 pts) — Target: 20%+
  const saveRate = avgInc > 0 ? ((avgInc - avgExp) / avgInc) * 100 : 0;
  const savePts = Math.min(25, Math.max(0, saveRate <= 0 ? 0 : saveRate >= 30 ? 25 : saveRate >= 20 ? 20 : saveRate >= 10 ? 14 : saveRate >= 5 ? 8 : 3));
  const saveGrade = saveRate >= 25 ? 'A' : saveRate >= 20 ? 'A-' : saveRate >= 15 ? 'B+' : saveRate >= 10 ? 'B' : saveRate >= 5 ? 'C' : saveRate >= 0 ? 'D' : 'F';

  // 2. Investment Rate (0-20 pts) — Target: 15%+
  const invRate = avgInc > 0 ? (avgInv / avgInc) * 100 : 0;
  const invPts = Math.min(20, Math.max(0, invRate >= 20 ? 20 : invRate >= 15 ? 17 : invRate >= 10 ? 13 : invRate >= 5 ? 8 : invRate >= 1 ? 3 : 0));
  const invGrade = invRate >= 20 ? 'A' : invRate >= 15 ? 'A-' : invRate >= 10 ? 'B' : invRate >= 5 ? 'C' : 'D';

  // 3. Spending Consistency (0-20 pts) — Low volatility = good
  const expVals = recent.map(m => m.expenses);
  const expMean = expVals.reduce((s, v) => s + v, 0) / expVals.length;
  const expStd = Math.sqrt(expVals.reduce((s, v) => s + (v - expMean) ** 2, 0) / expVals.length);
  const cv = expMean > 0 ? (expStd / expMean) * 100 : 0;
  const conPts = Math.min(20, Math.max(0, cv <= 10 ? 20 : cv <= 20 ? 16 : cv <= 30 ? 12 : cv <= 50 ? 7 : 2));
  const conGrade = cv <= 10 ? 'A' : cv <= 20 ? 'B+' : cv <= 30 ? 'B' : cv <= 50 ? 'C' : 'D';

  // 4. Emergency Fund (0-20 pts) — Target: 6 months
  const liquidBal = Object.values(balances || {}).reduce((s, v) => s + v, 0);
  const moExpenses = avgExp || 1;
  const efMonths = liquidBal / moExpenses;
  const efPts = Math.min(20, Math.max(0, efMonths >= 6 ? 20 : efMonths >= 4 ? 16 : efMonths >= 3 ? 12 : efMonths >= 1 ? 7 : efMonths >= 0.5 ? 3 : 0));
  const efGrade = efMonths >= 6 ? 'A' : efMonths >= 4 ? 'B+' : efMonths >= 3 ? 'B' : efMonths >= 1 ? 'C' : 'D';

  // 5. Category Diversification (0-15 pts) — Not over-concentrated
  const cats = {};
  txns.filter(t => t.amt < 0 && !['Investing', 'Transfer', 'Income'].includes(t.cat)).forEach(t => { cats[t.cat] = (cats[t.cat] || 0) + Math.abs(t.amt); });
  const totalSpend = Object.values(cats).reduce((s, v) => s + v, 0);
  const catPcts = Object.values(cats).map(v => v / (totalSpend || 1));
  const maxCatPct = Math.max(...catPcts, 0) * 100;
  const numCats = Object.keys(cats).length;
  const divPts = Math.min(15, Math.max(0, maxCatPct <= 25 ? 15 : maxCatPct <= 35 ? 12 : maxCatPct <= 50 ? 8 : maxCatPct <= 70 ? 4 : 1));
  const divGrade = maxCatPct <= 25 ? 'A' : maxCatPct <= 35 ? 'B+' : maxCatPct <= 50 ? 'B' : maxCatPct <= 70 ? 'C' : 'D';

  const total = savePts + invPts + conPts + efPts + divPts;
  const overallGrade = total >= 85 ? 'A' : total >= 75 ? 'A-' : total >= 65 ? 'B+' : total >= 55 ? 'B' : total >= 45 ? 'B-' : total >= 35 ? 'C' : total >= 25 ? 'D' : 'F';

  // Historical scores (per month)
  const history = mKeys.map(mk => {
    const m = months[mk];
    const sr = m.income > 0 ? ((m.income - m.expenses) / m.income) * 100 : 0;
    const ir = m.income > 0 ? (m.invested / m.income) * 100 : 0;
    const sp = Math.min(25, sr >= 30 ? 25 : sr >= 20 ? 20 : sr >= 10 ? 14 : sr >= 5 ? 8 : sr >= 0 ? 3 : 0);
    const ip = Math.min(20, ir >= 20 ? 20 : ir >= 15 ? 17 : ir >= 10 ? 13 : ir >= 5 ? 8 : 0);
    return { mk, label: `${MTHS[parseInt(mk.split('-')[1]) - 1]}`, score: sp + ip + conPts + efPts + divPts };
  });

  // Recommendations
  const recs = [];
  if (saveRate < 20) recs.push({ icon: '💰', text: `Increase savings rate from ${saveRate.toFixed(0)}% to 20%+ (save ${fmtD((0.2 * avgInc) - (avgInc - avgExp))} more/mo)`, priority: 'high' });
  if (invRate < 15) recs.push({ icon: '📈', text: `Boost investment rate from ${invRate.toFixed(0)}% to 15%+ of income`, priority: invRate < 5 ? 'high' : 'medium' });
  if (efMonths < 6) recs.push({ icon: '🛡️', text: `Build emergency fund from ${efMonths.toFixed(1)} to 6 months (need ${fmtD(6 * moExpenses - liquidBal)} more)`, priority: efMonths < 3 ? 'high' : 'medium' });
  if (cv > 30) recs.push({ icon: '📊', text: `Reduce spending volatility (${cv.toFixed(0)}% CV) — set firm category budgets`, priority: 'medium' });
  if (maxCatPct > 40) recs.push({ icon: '🎯', text: `Top category is ${maxCatPct.toFixed(0)}% of spending — review for optimization`, priority: 'low' });

  return {
    total, overallGrade, history,
    metrics: [
      { name: 'Savings Rate', pts: savePts, max: 25, grade: saveGrade, value: `${saveRate.toFixed(1)}%`, detail: `Target: 20%+`, color: '#34d399' },
      { name: 'Investment Rate', pts: invPts, max: 20, grade: invGrade, value: `${invRate.toFixed(1)}%`, detail: `Target: 15%+`, color: '#3b82f6' },
      { name: 'Spending Stability', pts: conPts, max: 20, grade: conGrade, value: `${cv.toFixed(0)}% CV`, detail: `Lower = better`, color: '#f59e0b' },
      { name: 'Emergency Fund', pts: efPts, max: 20, grade: efGrade, value: `${efMonths.toFixed(1)} mo`, detail: `Target: 6 months`, color: '#8b5cf6' },
      { name: 'Diversification', pts: divPts, max: 15, grade: divGrade, value: `${numCats} categories`, detail: `Max ${maxCatPct.toFixed(0)}% in one`, color: '#ec4899' },
    ],
    recs,
    stats: { saveRate, invRate, cv, efMonths, maxCatPct, avgInc, avgExp, avgInv },
  };
}

function HealthScoreView({ txns, settings, recurring, balances }) {
  const score = useMemo(() => calcHealthScore(txns, settings, recurring, balances), [txns, settings, recurring, balances]);
  if (!score) return <Card style={{ textAlign: 'center', padding: '40px 20px' }}><div style={{ fontSize: 36, marginBottom: 10 }}>❤️</div><div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 6 }}>Need More Data</div><div style={{ fontSize: 12, color: T.tm }}>Upload at least 2 months of transactions to calculate your health score.</div></Card>;

  const { total, overallGrade, metrics, recs, history } = score;
  const ringColor = total >= 75 ? T.gn : total >= 55 ? T.gd : total >= 35 ? '#f97316' : T.rd;
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (total / 100) * circumference;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {/* Score Ring + Grade */}
    <Card glow={ringColor} style={{ textAlign: 'center', padding: '30px 20px' }}>
      <svg width="140" height="140" style={{ margin: '0 auto', display: 'block' }}>
        <circle cx="70" cy="70" r="52" stroke="rgba(0,0,0,0.04)" strokeWidth="10" fill="none" />
        <circle cx="70" cy="70" r="52" stroke={ringColor} strokeWidth="10" fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }} />
        <text x="70" y="62" textAnchor="middle" style={{ fontSize: 28, fontWeight: 800, fontFamily: T.mo, fill: ringColor }}>{total}</text>
        <text x="70" y="82" textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: T.td }}>/100</text>
      </svg>
      <div style={{ marginTop: 12, fontSize: 24, fontWeight: 800, color: ringColor }}>{overallGrade}</div>
      <div style={{ fontSize: 12, color: T.tm, marginTop: 4 }}>
        {total >= 80 ? 'Excellent financial health' : total >= 65 ? 'Good — room to optimize' : total >= 45 ? 'Fair — focus on key areas' : 'Needs attention — see recommendations'}
      </div>
    </Card>

    {/* Metric Breakdown */}
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 14 }}>Score Breakdown</div>
      {metrics.map(m => {
        const pct = (m.pts / m.max) * 100;
        return <div key={m.name} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.tx }}>{m.name}</span>
              <Badge color={m.color}>{m.grade}</Badge>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: T.tm }}>{m.value}</span>
              <span style={{ fontSize: 11, fontFamily: T.mo, fontWeight: 700, color: m.color }}>{m.pts}/{m.max}</span>
            </div>
          </div>
          <div style={{ height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: m.color, borderRadius: 3, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 10, color: T.td, marginTop: 3 }}>{m.detail}</div>
        </div>;
      })}
    </Card>

    {/* Score Trend */}
    {history.length > 2 && <Card>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Score Trend</div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={history}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.bd} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: T.td }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: T.td, fontFamily: T.mo }} tickLine={false} axisLine={false} />
          <Tooltip content={<Tip />} />
          <Area type="monotone" dataKey="score" name="Score" fill={`${ringColor}20`} stroke={ringColor} strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>}

    {/* Recommendations */}
    {recs.length > 0 && <Card glow={T.gd}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>Recommendations</div>
      {recs.map((r, i) => <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < recs.length - 1 ? `1px solid ${T.bd}` : 'none', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{r.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.5 }}>{r.text}</div>
          <Badge color={r.priority === 'high' ? T.rd : r.priority === 'medium' ? T.gd : T.bl}>{r.priority}</Badge>
        </div>
      </div>)}
    </Card>}

    <div style={{ textAlign: 'center', fontSize: 10, color: T.td, padding: '6px 0' }}>Score based on last 6 months of data. Update balances in Net Worth for best accuracy.</div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE 2: ANOMALY DETECTION + SMART ALERTS
// ═══════════════════════════════════════════════════════════════════════════
function generateAlerts(txns, recurring) {
  const alerts = [];
  const now = new Date();
  const curMk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = {};
  txns.forEach(t => {
    const mk = mkey(t.date); if (!mk || ['Investing', 'Transfer', 'Income'].includes(t.cat)) return;
    if (t.amt >= 0) return;
    if (!months[mk]) months[mk] = { cats: {}, merchants: {}, daily: {}, total: 0 };
    const amt = Math.abs(t.amt);
    months[mk].cats[t.cat] = (months[mk].cats[t.cat] || 0) + amt;
    const v = normVendor(t.desc);
    if (v && v.length >= 3) months[mk].merchants[v] = (months[mk].merchants[v] || 0) + amt;
    months[mk].daily[t.date] = (months[mk].daily[t.date] || 0) + amt;
    months[mk].total += amt;
  });
  const mKeys = Object.keys(months).sort();
  const curMonth = months[curMk];
  const prevKeys = mKeys.filter(k => k < curMk).slice(-3);
  const prevMonths = prevKeys.map(k => months[k]);

  if (!curMonth || prevMonths.length < 2) return alerts;

  // 1. Category spending alerts (30%+ above 3-month avg)
  Object.entries(curMonth.cats).forEach(([cat, amt]) => {
    const prevAvg = prevMonths.reduce((s, m) => s + (m.cats[cat] || 0), 0) / prevMonths.length;
    if (prevAvg > 50 && amt > prevAvg * 1.3) {
      const pctOver = ((amt / prevAvg - 1) * 100).toFixed(0);
      alerts.push({ type: 'category', severity: amt > prevAvg * 1.6 ? 'high' : 'medium', icon: CATS[cat]?.icon || '📌', title: `${cat} spending up ${pctOver}%`, detail: `${fmtD(amt)} this month vs ${fmtD(prevAvg)} avg`, color: CATS[cat]?.color || T.gd });
    }
  });

  // 2. Merchant price increases (recurring charges costing more)
  recurring.filter(r => r.active).forEach(r => {
    const rTxns = txns.filter(t => normVendor(t.desc) === r.vendor && t.amt < 0).sort((a, b) => b.date.localeCompare(a.date));
    if (rTxns.length >= 3) {
      const recent = Math.abs(rTxns[0].amt);
      const prev = Math.abs(rTxns[2].amt);
      if (prev > 0 && recent > prev * 1.05 && (recent - prev) >= 1) {
        alerts.push({ type: 'price', severity: 'medium', icon: '💲', title: `${r.name} price increase`, detail: `Was ${fmtD(prev)} → now ${fmtD(recent)} (+${fmtD(recent - prev)})`, color: T.gd });
      }
    }
  });

  // 3. High-spend days (> 2x daily average)
  const allDays = Object.values(months).flatMap(m => Object.values(m.daily));
  const dayAvg = allDays.length > 0 ? allDays.reduce((s, v) => s + v, 0) / allDays.length : 0;
  if (curMonth.daily && dayAvg > 0) {
    Object.entries(curMonth.daily).filter(([_, amt]) => amt > dayAvg * 2.5 && amt > 100).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([date, amt]) => {
      alerts.push({ type: 'spike', severity: amt > dayAvg * 4 ? 'high' : 'medium', icon: '⚡', title: `High-spend day: ${date}`, detail: `${fmtD(amt)} — ${(amt / dayAvg).toFixed(1)}x your daily average of ${fmtD(dayAvg)}`, color: '#f97316' });
    });
  }

  // 4. Month-over-month total spending change
  if (prevMonths.length >= 1) {
    const prevTotal = prevMonths.reduce((s, m) => s + m.total, 0) / prevMonths.length;
    if (prevTotal > 100 && curMonth.total > prevTotal * 1.25) {
      const pctUp = ((curMonth.total / prevTotal - 1) * 100).toFixed(0);
      alerts.push({ type: 'total', severity: curMonth.total > prevTotal * 1.5 ? 'high' : 'medium', icon: '📊', title: `Total spending up ${pctUp}%`, detail: `${fmtD(curMonth.total)} this month vs ${fmtD(prevTotal)} avg`, color: T.rd });
    }
  }

  // 5. Year-over-year comparison (same month last year)
  const yoyMk = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const yoyMonth = months[yoyMk];
  if (yoyMonth) {
    Object.entries(curMonth.cats).forEach(([cat, amt]) => {
      const yoyAmt = yoyMonth.cats[cat] || 0;
      if (yoyAmt > 50 && amt > yoyAmt * 1.4) {
        const pctUp = ((amt / yoyAmt - 1) * 100).toFixed(0);
        alerts.push({ type: 'yoy', severity: 'low', icon: '📅', title: `${cat}: ${pctUp}% more than last year`, detail: `${fmtD(amt)} vs ${fmtD(yoyAmt)} in ${MTHS[now.getMonth()]} ${now.getFullYear() - 1}`, color: '#a855f7' });
      }
    });
  }

  // 6. New recurring charges detected
  const recentRecur = recurring.filter(r => r.active && r.count <= 3);
  recentRecur.forEach(r => {
    alerts.push({ type: 'new_sub', severity: 'low', icon: '🆕', title: `New recurring: ${r.name}`, detail: `${fmtD(r.amount)} ${r.freq} (${r.count} charges seen)`, color: T.ac });
  });

  return alerts.sort((a, b) => { const sev = { high: 0, medium: 1, low: 2 }; return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2); });
}

function AlertsView({ txns, recurring }) {
  const alerts = useMemo(() => generateAlerts(txns, recurring), [txns, recurring]);
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.severity === filter);
  const counts = { all: alerts.length, high: alerts.filter(a => a.severity === 'high').length, medium: alerts.filter(a => a.severity === 'medium').length, low: alerts.filter(a => a.severity === 'low').length };

  if (alerts.length === 0) return <Card style={{ textAlign: 'center', padding: '40px 20px' }}><div style={{ fontSize: 36, marginBottom: 10 }}>✅</div><div style={{ fontSize: 14, fontWeight: 700, color: T.gn, marginBottom: 6 }}>All Clear</div><div style={{ fontSize: 12, color: T.tm }}>No anomalies detected. Your spending is on track.</div></Card>;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div className="fv-g4">
      <Stat label="Total Alerts" value={counts.all} color={T.ac} icon="🔔" />
      <Stat label="High" value={counts.high} color={T.rd} icon="🔴" />
      <Stat label="Medium" value={counts.medium} color={T.gd} icon="🟡" />
      <Stat label="Low" value={counts.low} color={T.bl} icon="🔵" />
    </div>
    <div style={{ display: 'flex', gap: 4 }}>
      {[['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].map(([k, l]) => <Btn key={k} active={filter === k} onClick={() => setFilter(k)} color={k === 'high' ? T.rd : k === 'medium' ? T.gd : k === 'low' ? T.bl : T.ac}>{l} ({counts[k]})</Btn>)}
    </div>
    {filtered.map((a, i) => <Card key={i} style={{ padding: '14px 16px', borderLeft: `3px solid ${a.severity === 'high' ? T.rd : a.severity === 'medium' ? T.gd : T.bl}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>{a.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>{a.title}</span>
            <Badge color={a.severity === 'high' ? T.rd : a.severity === 'medium' ? T.gd : T.bl}>{a.severity}</Badge>
          </div>
          <div style={{ fontSize: 11, color: T.tm, lineHeight: 1.5 }}>{a.detail}</div>
        </div>
      </div>
    </Card>)}
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE 3: SUBSCRIPTION AUDIT
// ═══════════════════════════════════════════════════════════════════════════
function SubsAuditView({ txns, recurring }) {
  const activeSubs = useMemo(() => recurring.filter(r => r.active), [recurring]);
  const annualTotal = activeSubs.reduce((s, r) => s + r.annual, 0);
  const monthlyTotal = activeSubs.reduce((s, r) => s + (r.freq === 'monthly' ? r.amount : r.annual / 12), 0);

  // Price increase detection
  const priceChanges = useMemo(() => {
    const changes = [];
    activeSubs.forEach(sub => {
      const subTxns = txns.filter(t => normVendor(t.desc) === sub.vendor && t.amt < 0).sort((a, b) => a.date.localeCompare(b.date));
      if (subTxns.length < 4) return;
      const amounts = subTxns.map(t => Math.abs(t.amt));
      const first3Avg = amounts.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
      const last3Avg = amounts.slice(-3).reduce((s, v) => s + v, 0) / 3;
      if (first3Avg > 0 && last3Avg > first3Avg * 1.03 && (last3Avg - first3Avg) >= 0.50) {
        const annIncrease = (last3Avg - first3Avg) * (sub.freq === 'monthly' ? 12 : sub.freq === 'quarterly' ? 4 : 1);
        changes.push({ ...sub, oldPrice: first3Avg, newPrice: last3Avg, increase: last3Avg - first3Avg, annIncrease });
      }
    });
    return changes.sort((a, b) => b.annIncrease - a.annIncrease);
  }, [activeSubs, txns]);

  // Dormant detection: expensive subs with low usage signals
  const dormantSubs = useMemo(() => {
    const now = new Date();
    return activeSubs.filter(sub => {
      if (sub.cat !== 'Subscriptions' && sub.cat !== 'Entertainment') return false;
      const moAmt = sub.freq === 'monthly' ? sub.amount : sub.annual / 12;
      return moAmt >= 15 && sub.count <= 6 && (now - new Date(sub.lastDate)) > 25 * 864e5;
    });
  }, [activeSubs]);

  // Category breakdown
  const catBreakdown = useMemo(() => {
    const cats = {};
    activeSubs.forEach(sub => {
      const cat = sub.cat || 'Other';
      if (!cats[cat]) cats[cat] = { count: 0, monthly: 0, annual: 0 };
      cats[cat].count++;
      cats[cat].monthly += sub.freq === 'monthly' ? sub.amount : sub.annual / 12;
      cats[cat].annual += sub.annual;
    });
    return Object.entries(cats).sort((a, b) => b[1].annual - a[1].annual);
  }, [activeSubs]);

  // Waste score (0-100, lower is better)
  const wasteScore = useMemo(() => {
    const priceIncreaseCost = priceChanges.reduce((s, c) => s + c.annIncrease, 0);
    const dormantCost = dormantSubs.reduce((s, d) => s + d.annual, 0);
    const wasteDollars = priceIncreaseCost + dormantCost;
    return Math.min(100, Math.round((wasteDollars / (annualTotal || 1)) * 100));
  }, [priceChanges, dormantSubs, annualTotal]);

  const wasteColor = wasteScore <= 10 ? T.gn : wasteScore <= 25 ? T.gd : wasteScore <= 50 ? '#f97316' : T.rd;
  const pieData = catBreakdown.map(([cat, d]) => ({ name: cat, value: d.annual, color: CATS[cat]?.color || '#94a3b8' }));

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="fv-g4">
      <Stat label="Annual Subs" value={fmtK(annualTotal)} color={T.ac} icon="📋" sub={`${activeSubs.length} active`} />
      <Stat label="Monthly" value={fmtD(monthlyTotal)} color={T.gd} icon="🗓️" sub={`${fmtD(monthlyTotal * 12)}/yr`} />
      <Stat label="Price Hikes" value={priceChanges.length} color={priceChanges.length > 0 ? T.rd : T.gn} icon="💲" sub={priceChanges.length > 0 ? `+${fmtD(priceChanges.reduce((s, c) => s + c.annIncrease, 0))}/yr` : 'None detected'} />
      <Stat label="Waste Score" value={`${wasteScore}%`} color={wasteColor} icon={wasteScore <= 10 ? '✅' : '⚠️'} sub={wasteScore <= 10 ? 'Lean & efficient' : 'Room to optimize'} />
    </div>

    {/* Category Breakdown */}
    <div className="fv-gm">
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 14 }}>All Subscriptions</div>
        {activeSubs.sort((a, b) => b.annual - a.annual).map((sub, i) => {
          const m = CATS[sub.cat] || CATS.Other;
          const moAmt = sub.freq === 'monthly' ? sub.amount : sub.annual / 12;
          const hasHike = priceChanges.find(c => c.vendor === sub.vendor);
          return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.bd}` }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: `${m.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{m.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sub.name}
                {hasHike && <span style={{ marginLeft: 5, fontSize: 9, padding: '1px 5px', borderRadius: 4, background: `${T.rd}15`, color: T.rd }}>PRICE ↑</span>}
              </div>
              <div style={{ fontSize: 10, color: T.td }}>{sub.freq} · last: {sub.lastDate}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, fontFamily: T.mo, fontWeight: 700, color: T.tx }}>{fmtD(moAmt)}<span style={{ fontSize: 9, color: T.td }}>/mo</span></div>
              <div style={{ fontSize: 10, fontFamily: T.mo, color: T.td }}>{fmtD(sub.annual)}/yr</div>
            </div>
          </div>;
        })}
      </Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.tx, marginBottom: 10 }}>By Category</div>
          {pieData.length > 0 && <ResponsiveContainer width="100%" height={100}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={25} outerRadius={45} dataKey="value" strokeWidth={0}>{pieData.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart></ResponsiveContainer>}
          {catBreakdown.map(([cat, d]) => <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 5 }}>
            <span style={{ color: T.tm }}>{CATS[cat]?.icon || '📌'} {cat} ({d.count})</span>
            <span style={{ fontFamily: T.mo, fontWeight: 600, color: T.tx }}>{fmtD(d.monthly)}/mo</span>
          </div>)}
        </Card>
        {priceChanges.length > 0 && <Card glow={T.rd}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.rd, marginBottom: 10 }}>Price Increases Detected</div>
          {priceChanges.map((c, i) => <div key={i} style={{ padding: '8px 0', borderBottom: i < priceChanges.length - 1 ? `1px solid ${T.bd}` : 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{c.name}</div>
            <div style={{ fontSize: 11, color: T.tm, marginTop: 2 }}>{fmtD(c.oldPrice)} → {fmtD(c.newPrice)} <span style={{ color: T.rd, fontWeight: 700 }}>+{fmtD(c.increase)}</span></div>
            <div style={{ fontSize: 10, color: T.td, marginTop: 1 }}>Costing you {fmtD(c.annIncrease)}/yr more</div>
          </div>)}
        </Card>}
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE 4: MULTI-GOAL SAVINGS / SINKING FUNDS
// ═══════════════════════════════════════════════════════════════════════════
function GoalsView({ settings, txns, onSave }) {
  const goals = settings?.goals || [];
  const [showAdd, setShowAdd] = useState(false);
  const [newGoal, setNewGoal] = useState({ name: '', target: '', deadline: '', icon: '🎯', saved: 0, monthly: '' });

  // Calculate monthly income/expenses for projection
  const monthlyStats = useMemo(() => {
    const months = {};
    txns.forEach(t => {
      const mk = mkey(t.date); if (!mk) return;
      if (!months[mk]) months[mk] = { income: 0, expenses: 0 };
      if (t.amt > 0 && !['Investing', 'Transfer'].includes(t.cat)) months[mk].income += t.amt;
      if (t.amt < 0 && !['Investing', 'Transfer'].includes(t.cat)) months[mk].expenses += Math.abs(t.amt);
    });
    const vals = Object.values(months);
    if (!vals.length) return { avgIncome: 0, avgExpenses: 0, surplus: 0 };
    const avgIncome = vals.reduce((s, v) => s + v.income, 0) / vals.length;
    const avgExpenses = vals.reduce((s, v) => s + v.expenses, 0) / vals.length;
    return { avgIncome, avgExpenses, surplus: avgIncome - avgExpenses };
  }, [txns]);

  const ICONS = ['🎯', '🏖️', '🚗', '🏠', '💍', '🎓', '🛡️', '💻', '🎉', '🏋️', '👶', '🌍'];

  const handleAdd = () => {
    const target = parseFloat(newGoal.target) || 0;
    const saved = parseFloat(newGoal.saved) || 0;
    const monthly = parseFloat(newGoal.monthly) || 0;
    if (!newGoal.name || target <= 0) return;
    const updated = [...goals, { id: Date.now(), name: newGoal.name, target, deadline: newGoal.deadline, icon: newGoal.icon, saved, monthly, createdAt: new Date().toISOString().slice(0, 10) }];
    onSave({ ...settings, goals: updated });
    setNewGoal({ name: '', target: '', deadline: '', icon: '🎯', saved: 0, monthly: '' });
    setShowAdd(false);
  };

  const handleDelete = (id) => {
    onSave({ ...settings, goals: goals.filter(g => g.id !== id) });
  };

  const handleUpdate = (id, field, value) => {
    onSave({ ...settings, goals: goals.map(g => g.id === id ? { ...g, [field]: value } : g) });
  };

  const totalNeeded = goals.reduce((s, g) => s + Math.max(0, g.target - g.saved), 0);
  const totalSaved = goals.reduce((s, g) => s + g.saved, 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);
  const totalMonthly = goals.reduce((s, g) => s + (g.monthly || 0), 0);
  const surplusAfterGoals = monthlyStats.surplus - totalMonthly;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="fv-g4">
      <Stat label="Total Saved" value={fmtK(totalSaved)} color={T.gn} icon="💰" sub={`of ${fmtK(totalTarget)} target`} />
      <Stat label="Still Needed" value={fmtK(totalNeeded)} color={T.gd} icon="🎯" />
      <Stat label="Monthly Alloc" value={fmtD(totalMonthly)} color={T.ac} icon="📆" sub={`${fmtD(totalMonthly * 12)}/yr`} />
      <Stat label="After Goals" value={fmtD(surplusAfterGoals)} color={surplusAfterGoals >= 0 ? T.gn : T.rd} icon={surplusAfterGoals >= 0 ? '✅' : '⚠️'} sub={surplusAfterGoals >= 0 ? 'Surplus available' : 'Over-allocated'} />
    </div>

    {/* Goal Cards */}
    {goals.map(g => {
      const pct = g.target > 0 ? Math.min((g.saved / g.target) * 100, 100) : 0;
      const remaining = Math.max(0, g.target - g.saved);
      const monthsLeft = g.monthly > 0 ? Math.ceil(remaining / g.monthly) : null;
      const eta = monthsLeft ? new Date(new Date().setMonth(new Date().getMonth() + monthsLeft)).toISOString().slice(0, 7) : null;
      const onTrack = g.deadline && eta ? eta <= g.deadline : null;
      const color = pct >= 100 ? T.gn : pct >= 50 ? T.ac : T.gd;

      return <Card key={g.id} glow={pct >= 100 ? T.gn : null}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{g.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>{g.name}</div>
              <div style={{ fontSize: 10, color: T.td }}>
                {g.deadline && `Due: ${g.deadline}`}
                {monthsLeft && <span> · ~{monthsLeft} months to go</span>}
                {onTrack !== null && <span style={{ color: onTrack ? T.gn : T.rd, fontWeight: 700 }}> {onTrack ? '✓ On track' : '✗ Behind'}</span>}
              </div>
            </div>
          </div>
          <button onClick={() => handleDelete(g.id)} style={{ fontSize: 10, background: `${T.rd}12`, border: 'none', borderRadius: 6, padding: '3px 8px', color: T.rd, cursor: 'pointer' }}>Delete</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
          <span style={{ color: T.tm }}>{fmtD(g.saved)} saved</span>
          <span style={{ fontFamily: T.mo, fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
        </div>
        <div style={{ height: 8, background: 'rgba(0,0,0,0.04)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${pct >= 100 ? '#34d399' : '#c084fc'})`, borderRadius: 4, transition: 'width 0.4s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.td, marginBottom: 10 }}>
          <span>Target: {fmtD(g.target)}</span>
          <span>Remaining: {fmtD(remaining)}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ fontSize: 9, color: T.td, display: 'block', marginBottom: 3 }}>Saved ($)</label>
            <input type="number" value={g.saved || ''} onChange={e => handleUpdate(g.id, 'saved', parseFloat(e.target.value) || 0)} style={{ ...IS, padding: '6px 10px', fontSize: 11 }} />
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ fontSize: 9, color: T.td, display: 'block', marginBottom: 3 }}>Monthly ($)</label>
            <input type="number" value={g.monthly || ''} onChange={e => handleUpdate(g.id, 'monthly', parseFloat(e.target.value) || 0)} style={{ ...IS, padding: '6px 10px', fontSize: 11 }} />
          </div>
        </div>
      </Card>;
    })}

    {/* Add Goal */}
    {showAdd ? <Card glow={T.ac}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 14 }}>New Goal</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
        {ICONS.map(ic => <button key={ic} onClick={() => setNewGoal(p => ({ ...p, icon: ic }))} style={{ fontSize: 20, width: 36, height: 36, borderRadius: 8, border: newGoal.icon === ic ? `2px solid ${T.ac}` : `1px solid ${T.bd}`, background: newGoal.icon === ic ? T.ag : 'transparent', cursor: 'pointer' }}>{ic}</button>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Goal Name</label><input value={newGoal.name} onChange={e => setNewGoal(p => ({ ...p, name: e.target.value }))} placeholder="Emergency Fund" style={IS} /></div>
        <div className="fv-g2">
          <div><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Target ($)</label><input type="number" value={newGoal.target} onChange={e => setNewGoal(p => ({ ...p, target: e.target.value }))} placeholder="10000" style={IS} /></div>
          <div><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Deadline</label><input type="date" value={newGoal.deadline} onChange={e => setNewGoal(p => ({ ...p, deadline: e.target.value }))} style={{ ...IS, colorScheme: 'light' }} /></div>
        </div>
        <div className="fv-g2">
          <div><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Already Saved ($)</label><input type="number" value={newGoal.saved} onChange={e => setNewGoal(p => ({ ...p, saved: e.target.value }))} placeholder="0" style={IS} /></div>
          <div><label style={{ fontSize: 10, color: T.td, display: 'block', marginBottom: 3 }}>Monthly Contribution ($)</label><input type="number" value={newGoal.monthly} onChange={e => setNewGoal(p => ({ ...p, monthly: e.target.value }))} placeholder="500" style={IS} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={handleAdd} style={{ flex: 1, padding: '10px 18px', borderRadius: T.rs, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: T.f, background: T.ac, color: '#fff' }}>Create Goal</button>
          <button onClick={() => setShowAdd(false)} style={{ padding: '10px 18px', borderRadius: T.rs, border: `1px solid ${T.bdl}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: T.f, background: 'transparent', color: T.tm }}>Cancel</button>
        </div>
      </div>
    </Card> : <button onClick={() => setShowAdd(true)} style={{ padding: '14px', borderRadius: T.r, border: `2px dashed ${T.bdl}`, background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: T.f, color: T.ac }}>+ Add New Goal</button>}

    {/* Sinking Fund Summary */}
    {goals.length > 0 && monthlyStats.surplus > 0 && <Card>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 10 }}>Sinking Fund Allocator</div>
      <div style={{ fontSize: 11, color: T.tm, marginBottom: 12 }}>Your avg monthly surplus is {fmtD(monthlyStats.surplus)}. Here's how your goals fit:</div>
      <div style={{ height: 24, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
        {goals.map(g => {
          const pct = monthlyStats.surplus > 0 ? ((g.monthly || 0) / monthlyStats.surplus) * 100 : 0;
          const colors = ['#f97066', '#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#06b6d4', '#ec4899', '#14b8a6'];
          const ci = goals.indexOf(g) % colors.length;
          return pct > 0 ? <div key={g.id} style={{ width: `${pct}%`, background: colors[ci], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap' }}>{pct > 10 ? g.icon : ''}</div> : null;
        })}
        {surplusAfterGoals > 0 && <div style={{ flex: 1, background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: T.td }}>Unallocated</div>}
      </div>
      {goals.map((g, i) => {
        const colors = ['#f97066', '#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#06b6d4', '#ec4899', '#14b8a6'];
        const ci = i % colors.length;
        return <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: colors[ci] }} />
            <span style={{ color: T.tm }}>{g.icon} {g.name}</span>
          </div>
          <span style={{ fontFamily: T.mo, fontWeight: 600, color: T.tx }}>{fmtD(g.monthly || 0)}/mo</span>
        </div>;
      })}
      {surplusAfterGoals > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderTop: `1px solid ${T.bd}`, marginTop: 4 }}>
        <span style={{ color: T.gn }}>Remaining surplus</span>
        <span style={{ fontFamily: T.mo, fontWeight: 700, color: T.gn }}>{fmtD(surplusAfterGoals)}/mo</span>
      </div>}
    </Card>}
  </div>;
}

const NAV = [
  { id: 'dashboard', l: 'Dashboard', ic: '🏠' },
  { id: 'transactions', l: 'Transactions', ic: '💳' },
  { id: 'budget', l: 'Budget & Goals', ic: '🎯' },
  { id: 'insights', l: 'Insights', ic: '🧠' },
  { id: 'networth', l: 'Net Worth', ic: '💰' },
  { id: 'accounts', l: 'Accounts', ic: '🔗' },
  { id: 'settings', l: 'Settings', ic: '⚙️' },
];
const ACCT_TYPES = [
  { value: 'checking', label: 'Checking / Savings', icon: '🏦' },
  { value: 'credit', label: 'Credit Card', icon: '💳' },
  { value: 'investment', label: 'Investment / Brokerage', icon: '📈' },
  { value: 'crypto', label: 'Crypto', icon: '₿' },
];
const ACCT_COLORS = ['#22c55e', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#3b82f6', '#14b8a6', '#f97316'];
function getAccounts(settings) { return settings?.accounts || []; }
function getAccType(settings, accId) { const a = (settings?.accounts || []).find(a => a.id === accId); return a?.type || 'checking'; }

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
  const [txns, setTxns] = useState([]);
  const [view, setView] = useState('dashboard');
  const [loading, setLoading] = useState(null);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [splitTarget, setSplitTarget] = useState(null);
  const [learnToast, setLearnToast] = useState(null);
  const [fidelityData, setFidelityData] = useState(null);
  const [coinbaseData, setCoinbaseData] = useState(null);
  const [balances, setBalances] = useState({});
  const [subTab, setSubTab] = useState('budget');
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  // Persistent storage load + migrate old data format
  useEffect(() => { (async () => {
    let s = await ST.get('settings');
    const t = await ST.get('txns');
    const b = await ST.get('balances');
    // Migrate old format: if settings exist but have no accounts array, create from txn data
    if (s && !s.accounts) {
      const accIds = new Set();
      if (t) t.forEach(tx => { if (tx.acc) accIds.add(tx.acc); });
      const oldAccMap = { td: { label: 'TD Bank', type: 'checking', icon: '🏦' }, chase: { label: 'Chase', type: 'credit', icon: '💳' }, amex: { label: 'AMEX', type: 'credit', icon: '✦' }, fidelity: { label: 'Fidelity', type: 'investment', icon: '📈' }, coinbase: { label: 'Coinbase', type: 'crypto', icon: '₿' } };
      s.accounts = [...accIds].map((id, i) => ({ id, label: oldAccMap[id]?.label || id, type: oldAccMap[id]?.type || 'checking', icon: oldAccMap[id]?.icon || '🏦', color: ACCT_COLORS[i % ACCT_COLORS.length] }));
      if (!s.goals) s.goals = [];
      await ST.set('settings', s);
    }
    if (s) setSettings(s);
    if (t) setTxns(t);
    if (b) setBalances(b);
    setReady(true);
  })(); }, []);
  useEffect(() => { if (ready && txns.length > 0) ST.set('txns', txns); }, [txns, ready]);
  useEffect(() => { if (ready && Object.keys(balances).length > 0) ST.set('balances', balances); }, [balances, ready]);

  const accounts = useMemo(() => getAccounts(settings), [settings]);
  const txC = useMemo(() => { const c = {}; txns.forEach(t => { if (!t.splitOf) c[t.acc] = (c[t.acc] || 0) + 1; }); return c; }, [txns]);
  const accs = useMemo(() => accounts.map(a => ({ ...a, loaded: (txC[a.id] || 0) > 0 || (a.type === 'investment' && fidelityData) || (a.type === 'crypto' && coinbaseData), count: txC[a.id] || 0 })), [accounts, txC, fidelityData, coinbaseData]);
  const recur = useMemo(() => detectRecurring(txns), [txns]);
  const alertCount = useMemo(() => generateAlerts(txns, recur).filter(a => a.severity === 'high').length, [txns, recur]);
  const rules = settings?.customRules || [];
  const learnedRules = settings?.learnedRules || [];
  const dismissed = settings?.dismissedRecurring || [];
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const saveSett = useCallback(async (s) => { setSettings(s); await ST.set('settings', s); flash(); }, []);

  const handleOnboard = useCallback(async (s) => { setSettings(s); await ST.set('settings', s); }, []);

  // ── Add / remove accounts ─────────────────────────────────────────────
  const handleAddAccount = useCallback((acc) => {
    setSettings(prev => {
      const existing = prev?.accounts || [];
      const u = { ...prev, accounts: [...existing, { ...acc, id: `acc-${Date.now()}` }] };
      ST.set('settings', u); return u;
    }); flash();
  }, []);

  const handleRemoveAccount = useCallback((accId) => {
    setTxns(prev => { const u = prev.filter(t => t.acc !== accId); ST.set('txns', u); return u; });
    setBalances(prev => { const u = { ...prev }; delete u[accId]; ST.set('balances', u); return u; });
    setSettings(prev => {
      const u = { ...prev, accounts: (prev?.accounts || []).filter(a => a.id !== accId) };
      ST.set('settings', u); return u;
    }); flash();
  }, []);

  // ── UNIVERSAL IMPORT — auto-detects CSV format ────────────────────────
  const handleImport = useCallback(async (file, accId) => {
    setLoading(accId); setErr(null);
    try {
      const text = await file.text();
      const top = text.replace(/^\uFEFF/, '').split('\n').slice(0, 10).join('\n').toLowerCase();
      const accType = getAccType(settings, accId);

      // Auto-detect: is this a Fidelity positions CSV?
      const isFidelityPositions = top.includes('symbol') && (top.includes('current value') || top.includes('cost basis'));
      if (isFidelityPositions) {
        const data = parseFidelity(text);
        if (!data) { setErr('Could not parse investment positions. Expected columns: Symbol, Current Value, etc.'); setLoading(null); return; }
        setFidelityData(data);
        setBalances(prev => ({ ...prev, [accId]: data.totalValue }));
        flash(); setLoading(null); return;
      }

      // Auto-detect: is this a Coinbase transaction CSV?
      const isCoinbaseTx = (top.includes('id,') && top.includes('timestamp')) || (top.includes('transaction type') && top.includes('asset'));
      if (isCoinbaseTx) {
        const parsed = parseCSV(text, accId, settings, learnedRules, rules, accType);
        if (parsed.length > 0) setTxns(prev => mergeT(prev, parsed, accId));
        const portfolio = parseCoinbasePortfolio(text);
        if (portfolio?.holdings?.length) {
          try {
            const prices = await fetchLive(portfolio.holdings.map(h => h.asset));
            const holdings = portfolio.holdings.map(h => ({ ...h, price: prices[h.asset] || h.price }));
            const totalVal = holdings.reduce((s, h) => s + h.qty * h.price, 0);
            setCoinbaseData({ ...portfolio, holdings, totalVal, gain: totalVal - portfolio.totalCost, live: Object.keys(prices).length > 0 });
            setBalances(prev => ({ ...prev, [accId]: totalVal }));
          } catch { setCoinbaseData(portfolio); setBalances(prev => ({ ...prev, [accId]: portfolio.totalVal })); }
        }
        if (!parsed.length && !portfolio) { setErr('No transactions found. Make sure this is a valid transaction CSV.'); setLoading(null); return; }
        flash(); setLoading(null); return;
      }

      // Standard transaction CSV (bank, credit card, any format)
      const parsed = parseCSV(text, accId, settings, learnedRules, rules, accType);
      if (!parsed.length) { setErr('No transactions found. Make sure this is a valid CSV with date, description, and amount columns.'); setLoading(null); return; }
      setTxns(prev => mergeT(prev, parsed, accId));
      flash();
    } catch (e) { setErr(e.message); }
    setLoading(null);
  }, [settings, learnedRules, rules]);

  const handleClear = useCallback(async (accId) => {
    setTxns(prev => { const u = prev.filter(t => t.acc !== accId); ST.set('txns', u); return u; });
    setFidelityData(d => { if (d) return null; return d; });
    setCoinbaseData(d => { if (d) return null; return d; });
    setBalances(prev => { const u = { ...prev }; delete u[accId]; ST.set('balances', u); return u; });
  }, []);

  // ── AUTO-LEARNING RECATEGORIZATION ─────────────────────────────────────
  const handleRecat = useCallback((id, newCat) => {
    const txn = txns.find(t => t.id === id);
    if (!txn || txn.cat === newCat) return;
    const vendor = normVendor(txn.desc);

    // Update the single transaction
    setTxns(prev => {
      const u = prev.map(t => t.id === id ? { ...t, cat: newCat } : t);
      ST.set('txns', u);
      return u;
    });

    // Check if there are other transactions from the same vendor to learn from
    if (vendor && vendor.length >= 3) {
      const otherMatches = txns.filter(t =>
        t.id !== id && normVendor(t.desc) === vendor && t.cat !== newCat && t.amt < 0
      );
      if (otherMatches.length > 0) {
        // Show auto-learn toast
        setLearnToast({ txn, newCat, vendor, matchCount: otherMatches.length });
      }
    }
  }, [txns]);

  // Apply auto-learn to all matching vendor transactions
  const handleApplyLearn = useCallback(() => {
    if (!learnToast) return;
    const { vendor, newCat } = learnToast;

    // 1. Create a learned rule
    const newRule = { pattern: vendor, category: newCat, source: 'auto-learn' };
    setSettings(prev => {
      const existing = (prev?.learnedRules || []).filter(r => r.pattern !== vendor);
      const u = { ...prev, learnedRules: [...existing, newRule] };
      ST.set('settings', u);
      return u;
    });

    // 2. Recategorize all matching transactions
    setTxns(prev => {
      const u = prev.map(t => {
        if (normVendor(t.desc) === vendor && t.amt < 0 && !['Investing', 'Transfer'].includes(t.cat)) {
          return { ...t, cat: newCat };
        }
        return t;
      });
      ST.set('txns', u);
      return u;
    });

    setLearnToast(null);
    flash();
  }, [learnToast]);

  // ── SPLIT TRANSACTION ─────────────────────────────────────────────────
  const handleApplySplit = useCallback((originalTxn, parts) => {
    setTxns(prev => {
      // Remove original transaction
      const without = prev.filter(t => t.id !== originalTxn.id);
      // Add split parts
      const splitParts = parts.map((p, i) => ({
        id: `${originalTxn.id}-split-${i}`,
        date: originalTxn.date,
        desc: originalTxn.desc,
        cat: p.cat,
        acc: originalTxn.acc,
        amt: -Math.abs(parseFloat(p.amt)),
        splitOf: originalTxn.id,
      }));
      const u = [...without, ...splitParts].sort((a, b) => b.date.localeCompare(a.date));
      ST.set('txns', u);
      return u;
    });
    setSplitTarget(null);
    flash();
  }, []);

  const handleBudget = useCallback((cat, amt) => { setSettings(prev => { const u = { ...prev, budgets: { ...(prev?.budgets || {}), [cat]: amt } }; ST.set('settings', u); return u; }); }, []);
  const handleAddRule = useCallback((rule) => { setSettings(prev => { const u = { ...prev, customRules: [...(prev?.customRules || []), rule] }; ST.set('settings', u); setTxns(ts => { const upd = ts.map(t => { if (t.amt >= 0 || ['Investing', 'Transfer'].includes(t.cat)) return t; const d = (t.desc || '').toLowerCase(); try { let m = false; if (rule.matchType === 'contains') m = d.includes(rule.pattern.toLowerCase()); else if (rule.matchType === 'startsWith') m = d.startsWith(rule.pattern.toLowerCase()); else if (rule.matchType === 'exact') m = d === rule.pattern.toLowerCase(); else if (rule.matchType === 'regex') m = new RegExp(rule.pattern, 'i').test(d); if (m) return { ...t, cat: rule.category }; } catch {} return t; }); ST.set('txns', upd); return upd; }); return u; }); flash(); }, []);
  const handleDelRule = useCallback((i) => { setSettings(prev => { const r = [...(prev?.customRules || [])]; r.splice(i, 1); const u = { ...prev, customRules: r }; ST.set('settings', u); return u; }); flash(); }, []);
  const handleDelLearned = useCallback((i) => { setSettings(prev => { const r = [...(prev?.learnedRules || [])]; r.splice(i, 1); const u = { ...prev, learnedRules: r }; ST.set('settings', u); return u; }); flash(); }, []);
  const handleApplyRules = useCallback(() => { const cr = settings?.customRules || []; const lr = settings?.learnedRules || []; const tKw = (settings?.transferKeywords || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean); setTxns(ts => { const u = ts.filter(t => { const lower = (t.desc || '').toLowerCase(); if (TRANSFER_RE.test(lower)) return false; if (tKw.some(kw => kw && lower.includes(kw))) return false; return true; }).map(t => { if (['Investing'].includes(t.cat) && t.amt < 0) return t; const lower = (t.desc || '').toLowerCase(); const at = getAccType(settings, t.acc); if (t.amt > 0) { if (TRUE_INCOME_RE.test(lower)) return { ...t, cat: 'Income' }; if (REFUND_RE.test(lower) || at === 'credit') return { ...t, cat: guessCat(t.desc, lr, cr) }; const g = guessCat(t.desc, lr, cr); return { ...t, cat: g !== 'Other' ? g : (t.amt > 50 ? 'Income' : 'Other') }; } return { ...t, cat: guessCat(t.desc, lr, cr) }; }); ST.set('txns', u); return u; }); flash(); }, [settings]);
  const handleDismiss = useCallback(v => { setSettings(p => { const u = { ...p, dismissedRecurring: [...(p?.dismissedRecurring || []), v] }; ST.set('settings', u); return u; }); }, []);
  const handleUndismiss = useCallback(v => { setSettings(p => { const u = { ...p, dismissedRecurring: (p?.dismissedRecurring || []).filter(x => x !== v) }; ST.set('settings', u); return u; }); }, []);
  const handleNWUpdate = useCallback((h) => { setSettings(p => { const u = { ...p, netWorthHistory: h }; ST.set('settings', u); return u; }); }, []);
  const handleReset = useCallback(async () => { if (!window.confirm('Delete ALL data? This cannot be undone.')) return; await ST.del('settings'); await ST.del('txns'); setSettings(null); setTxns([]); }, []);

  if (!ready) return <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><link href={FU} rel="stylesheet" /><div style={{ color: T.ac, fontSize: 16, fontFamily: T.f }}>Loading…</div></div>;
  if (!settings) return <Onboard onDone={handleOnboard} />;

  const navItem = NAV.find(n => n.id === view);

  // Sub-tab selector component
  const TabBar = ({ tabs, active, onChange }) => <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 3, background: '#f1efe9', borderRadius: 12, width: 'fit-content' }}>
    {tabs.map(t => <button key={t.id} onClick={() => onChange(t.id)} style={{ padding: '7px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: active === t.id ? 700 : 500, fontFamily: T.f, background: active === t.id ? '#fff' : 'transparent', color: active === t.id ? T.tx : T.td, boxShadow: active === t.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s' }}>{t.label}</button>)}
  </div>;

  const sidebar = <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ marginBottom: 28, padding: '0 6px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: T.ac, letterSpacing: '-0.02em' }}>FinView</div>
      <div style={{ fontSize: 11, color: T.td, marginTop: 2 }}>Hey {settings.name} 👋</div>
    </div>
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      {NAV.map(n => <button key={n.id} onClick={() => { setView(n.id); setMenuOpen(false); setSubTab(n.id === 'budget' ? 'budget' : n.id === 'insights' ? 'health' : n.id === 'settings' ? 'profile' : ''); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: T.f, textAlign: 'left', width: '100%', fontSize: 13, transition: 'all 0.15s', background: view === n.id ? `${T.ac}10` : 'transparent', color: view === n.id ? T.ac : T.tm, fontWeight: view === n.id ? 700 : 500 }}>
        <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{n.ic}</span>{n.l}
        {n.id === 'insights' && alertCount > 0 && <span style={{ marginLeft: 'auto', fontSize: 8, padding: '1px 6px', borderRadius: 8, background: `${T.rd}12`, color: T.rd, fontWeight: 700 }}>{alertCount}</span>}
        {n.id === 'accounts' && accs.filter(a => a.loaded).length > 0 && <span style={{ marginLeft: 'auto', fontSize: 8, padding: '1px 6px', borderRadius: 8, background: `${T.gn}12`, color: T.gn, fontWeight: 700 }}>{accs.filter(a => a.loaded).length}</span>}
      </button>)}
    </nav>
    <div style={{ padding: '10px 12px', background: '#f8f6f2', borderRadius: 10, fontSize: 10, color: T.td, lineHeight: 1.6, marginTop: 12 }}>{txns.filter(t => !t.splitOf).length} transactions · {accs.filter(a => a.loaded).length} accounts</div>
  </div>;

  return <div style={{ display: 'flex', minHeight: '100vh', background: T.bg, fontFamily: T.f, color: T.tx }}>
    <link href={FU} rel="stylesheet" />
    <style>{`
      @media(max-width:768px){.fv-sb{display:none!important}.fv-mh{display:flex!important}.fv-mn{padding:16px 14px!important}.fv-g5,.fv-g4,.fv-g3{grid-template-columns:1fr 1fr!important}.fv-gm{grid-template-columns:1fr!important}}
      @media(min-width:769px){.fv-mh{display:none!important}.fv-mm{display:none!important}}
      .fv-g5{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
      .fv-g4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
      .fv-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
      .fv-g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .fv-gm{display:grid;grid-template-columns:5fr 3fr;gap:14px}
      *::-webkit-scrollbar{width:6px} *::-webkit-scrollbar-track{background:transparent} *::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.1);border-radius:3px}
    `}</style>

    {/* Desktop sidebar */}
    <div className="fv-sb" style={{ width: 220, background: T.sf, borderRight: `1px solid ${T.bd}`, padding: '22px 14px', flexShrink: 0, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', boxShadow: '2px 0 8px rgba(0,0,0,0.02)' }}>{sidebar}</div>

    {/* Mobile menu overlay */}
    {menuOpen && <div className="fv-mm" onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100, backdropFilter: 'blur(4px)' }}><div onClick={e => e.stopPropagation()} style={{ width: 260, height: '100%', background: T.sf, padding: '22px 14px', overflowY: 'auto', boxShadow: '4px 0 24px rgba(0,0,0,0.1)' }}>{sidebar}</div></div>}

    <div className="fv-mn" style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
      <div className="fv-mh" style={{ display: 'none', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button onClick={() => setMenuOpen(true)} style={{ background: 'none', border: 'none', fontSize: 22, color: T.tx, cursor: 'pointer', padding: 4 }}>☰</button>
        <div style={{ fontSize: 20, fontWeight: 800, color: T.ac }}>FinView</div>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: T.tx }}>{navItem?.l}</h1><div style={{ fontSize: 11, color: T.td, marginTop: 3 }}>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div></div>
          {saved && <Badge color={T.gn}>✓ Saved</Badge>}
        </div>

        {/* ── Dashboard ───────────────────────────────────────────── */}
        {view === 'dashboard' && <><div style={{ marginBottom: 14 }}><PeriodSel period={period} onChange={setPeriod} txns={txns} /></div><Dashboard txns={txns} period={period} recurring={recur} settings={settings} balances={balances} fidelityData={fidelityData} coinbaseData={coinbaseData} accounts={accounts} />{txns.length === 0 && <Card style={{ textAlign: 'center', padding: '40px 20px', marginTop: 14 }}><div style={{ fontSize: 40, marginBottom: 12 }}>📊</div><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Welcome to FinView!</div><div style={{ fontSize: 13, color: T.tm, marginBottom: 16 }}>Add an account and upload a CSV to start tracking your finances.</div><button onClick={() => setView('accounts')} style={{ padding: '11px 24px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, fontFamily: T.f, background: T.ac, color: '#fff', boxShadow: '0 4px 16px rgba(249,112,102,0.3)' }}>Add Your First Account →</button></Card>}</>}

        {/* ── Transactions ────────────────────────────────────────── */}
        {view === 'transactions' && <TxView txns={txns} period={period} setPeriod={setPeriod} onRecat={handleRecat} onSplit={setSplitTarget} />}

        {/* ── Budget & Goals (tabbed) ─────────────────────────────── */}
        {view === 'budget' && <>
          <TabBar tabs={[{ id: 'budget', label: '🎯 Budget' }, { id: 'goals', label: '🏆 Goals' }]} active={subTab} onChange={setSubTab} />
          <div style={{ marginBottom: 14 }}><PeriodSel period={period} onChange={setPeriod} txns={txns} /></div>
          {subTab === 'budget' && <BudgetView txns={txns} period={period} setPeriod={setPeriod} budgets={settings?.budgets || {}} onBudget={handleBudget} />}
          {subTab === 'goals' && <GoalsView settings={settings} txns={txns} onSave={saveSett} />}
        </>}

        {/* ── Insights (tabbed: Health · Alerts · Trends · Analytics · Subs · Cash Flow) ── */}
        {view === 'insights' && <>
          <TabBar tabs={[{ id: 'health', label: '❤️ Health' }, { id: 'alerts', label: '🔔 Alerts' }, { id: 'trends', label: '📈 Trends' }, { id: 'analytics', label: '💡 Analytics' }, { id: 'subs', label: '🔍 Subs' }, { id: 'cashflow', label: '🌊 Cash Flow' }]} active={subTab} onChange={setSubTab} />
          {subTab === 'health' && <HealthScoreView txns={txns} settings={settings} recurring={recur} balances={balances} />}
          {subTab === 'alerts' && <AlertsView txns={txns} recurring={recur} />}
          {subTab === 'trends' && <TrendsView txns={txns} />}
          {subTab === 'analytics' && <><div style={{ marginBottom: 12 }}><PeriodSel period={period} onChange={setPeriod} txns={txns} /></div><InsightsView txns={txns} period={period} /></>}
          {subTab === 'subs' && <SubsAuditView txns={txns} recurring={recur} />}
          {subTab === 'cashflow' && <CashFlowView txns={txns} recurring={recur} settings={settings} />}
        </>}

        {/* ── Net Worth ───────────────────────────────────────────── */}
        {view === 'networth' && <NetWorthView settings={settings} history={settings?.netWorthHistory || []} onUpdateHistory={handleNWUpdate} fidelityData={fidelityData} coinbaseData={coinbaseData} balances={balances} setBalances={setBalances} accounts={accounts} />}

        {/* ── Accounts (import/manage) ────────────────────────────── */}
        {view === 'accounts' && <ImportView accounts={accs} onImport={handleImport} onClear={handleClear} onAddAccount={handleAddAccount} onRemoveAccount={handleRemoveAccount} loading={loading} err={err} />}

        {/* ── Settings (tabbed: Profile · Rules · Recurring · Export) ── */}
        {view === 'settings' && <>
          <TabBar tabs={[{ id: 'profile', label: '⚙️ Profile' }, { id: 'rules', label: '🧠 Rules' }, { id: 'recurring', label: '🔄 Recurring' }, { id: 'export', label: '📄 Export' }]} active={subTab} onChange={setSubTab} />
          {subTab === 'profile' && <SettingsView settings={settings} onSave={saveSett} onReset={handleReset} />}
          {subTab === 'rules' && <RulesView rules={rules} learnedRules={learnedRules} txns={txns} onAdd={handleAddRule} onDel={handleDelRule} onApply={handleApplyRules} onDelLearned={handleDelLearned} />}
          {subTab === 'recurring' && <RecurView recurring={recur} dismissed={dismissed} onDismiss={handleDismiss} onUndo={handleUndismiss} />}
          {subTab === 'export' && <><div style={{ marginBottom: 12 }}><PeriodSel period={period} onChange={setPeriod} txns={txns} /></div><ExportView txns={txns} period={period} settings={settings} recurring={recur} /></>}
        </>}
      </div>
    </div>

    {/* Split transaction modal */}
    {splitTarget && <SplitModal txn={splitTarget} onApply={handleApplySplit} onClose={() => setSplitTarget(null)} />}

    {/* Auto-learn toast */}
    <LearnToast txn={learnToast?.txn} newCat={learnToast?.newCat} matchCount={learnToast?.matchCount} onApplyAll={handleApplyLearn} onDismiss={() => setLearnToast(null)} />
  </div>;
}
