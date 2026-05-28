// Toronto Street → Neighbourhood mapping
// Used to auto-tag Area: [Neighbourhood] from trade property addresses

const TORONTO_AREAS = {
  // Forest Hill
  'forest hill': 'Area: Forest Hill',
  'spadina rd': 'Area: Forest Hill',
  'russell hill': 'Area: Forest Hill',
  'dunvegan': 'Area: Forest Hill',
  'glenayr': 'Area: Forest Hill',
  'balmoral': 'Area: Forest Hill',
  'chaplin': 'Area: Forest Hill',
  'kilbarry': 'Area: Forest Hill',
  'felbrigg': 'Area: Forest Hill',
  'strathearn': 'Area: Forest Hill',
  'wychwood': 'Area: Forest Hill',
  'warren': 'Area: Forest Hill',
  'vesta': 'Area: Forest Hill',
  'lonsdale': 'Area: Forest Hill',
  'holton': 'Area: Forest Hill',
  'elderwood': 'Area: Forest Hill',

  // Lawrence Park / Lytton Park
  'lytton': 'Area: Lawrence Park',
  'lawrence ave': 'Area: Lawrence Park',
  'lawrence park': 'Area: Lawrence Park',
  'chatsworth': 'Area: Lawrence Park',
  'dawlish': 'Area: Lawrence Park',
  'alexandra wood': 'Area: Lawrence Park',
  'briar hill': 'Area: Lawrence Park',
  'glenrose': 'Area: Lawrence Park',
  'edgewood': 'Area: Lawrence Park',
  'woburn': 'Area: Lawrence Park',

  // Cedarvale / Avondale
  'cedarvale': 'Area: Cedarvale',
  'avondale': 'Area: Cedarvale',
  'heath': 'Area: Cedarvale',
  'hillsdale': 'Area: Cedarvale',
  'erskine': 'Area: Cedarvale',
  'soudan': 'Area: Cedarvale',
  'davisville': 'Area: Cedarvale',

  // Humewood / Fairbank
  'humewood': 'Area: Humewood',
  'wright': 'Area: Humewood',
  'atlas': 'Area: Humewood',
  'glenholme': 'Area: Glenholme',
  'dufferin': 'Area: Glenholme',
  'cranbrooke': 'Area: Cranbrooke',
  'elm ridge': 'Area: Elm Ridge',
  'regal': 'Area: Regal Heights',
  'lauder': 'Area: Regal Heights',
  'rosemount': 'Area: Regal Heights',
  'cherrywood': 'Area: Regal Heights',

  // Midtown
  'eglinton': 'Area: Midtown',
  'mt pleasant': 'Area: Midtown',
  'mount pleasant': 'Area: Midtown',
  'broadway': 'Area: Midtown',
  'belsize': 'Area: Midtown',
  'glebe': 'Area: Midtown',
  'merton': 'Area: Midtown',
  'manor': 'Area: Midtown',
  'roehampton': 'Area: Midtown',
  'redpath': 'Area: Midtown',
  'balliol': 'Area: Midtown',
  'berwick': 'Area: Midtown',

  // Yonge & St Clair / Deer Park
  'st clair': 'Area: Deer Park',
  'deer park': 'Area: Deer Park',
  'heath st': 'Area: Deer Park',
  'crescent rd': 'Area: Deer Park',
  'whitney': 'Area: Deer Park',
  'price': 'Area: Deer Park',
  'delisle': 'Area: Deer Park',
  'sheldrake': 'Area: Deer Park',

  // Rosedale
  'rosedale': 'Area: Rosedale',
  'cluny': 'Area: Rosedale',
  'highland': 'Area: Rosedale',
  'elm ave': 'Area: Rosedale',
  'hawthorn': 'Area: Rosedale',
  'chestnut park': 'Area: Rosedale',
  'glen rd': 'Area: Rosedale',
  'roxborough': 'Area: Rosedale',
  'severn': 'Area: Rosedale',
  'binscarth': 'Area: Rosedale',
  'beaumont': 'Area: Rosedale',

  // Moore Park
  'moore park': 'Area: Moore Park',
  'moore ave': 'Area: Moore Park',
  'whitney ave': 'Area: Moore Park',
  'st leonard': 'Area: Moore Park',
  'dunbar': 'Area: Moore Park',

  // Annex
  'annex': 'Area: The Annex',
  'bloor st w': 'Area: The Annex',
  'madison': 'Area: The Annex',
  'huron': 'Area: The Annex',
  'spadina ave': 'Area: The Annex',
  'brunswick': 'Area: The Annex',
  'lowther': 'Area: The Annex',
  'admiral': 'Area: The Annex',
  'walmer': 'Area: The Annex',
  'bernard': 'Area: The Annex',
  'dupont': 'Area: The Annex',

  // Casa Loma / Wychwood
  'casa loma': 'Area: Casa Loma',
  'davenport': 'Area: Wychwood',
  'bathurst st': 'Area: Wychwood',
  'alcina': 'Area: Wychwood',
  'wychwood park': 'Area: Wychwood',
  'benson': 'Area: Wychwood',
  'wellwood': 'Area: Wychwood',

  // Summerhill
  'summerhill': 'Area: Summerhill',
  'shaftesbury': 'Area: Summerhill',
  'macpherson': 'Area: Summerhill',
  'cluny dr': 'Area: Summerhill',

  // Yorkville / Bloor-Yorkville
  'yorkville': 'Area: Yorkville',
  'cumberland': 'Area: Yorkville',
  'hazelton': 'Area: Yorkville',
  'scollard': 'Area: Yorkville',
  'tranby': 'Area: Yorkville',
  'avenue rd': 'Area: Yorkville',

  // Leaside
  'leaside': 'Area: Leaside',
  'research': 'Area: Leaside',
  'bessborough': 'Area: Leaside',
  'sutherland': 'Area: Leaside',
  'randolph': 'Area: Leaside',
  'hanna': 'Area: Leaside',
  'wicksteed': 'Area: Leaside',
  'millwood': 'Area: Leaside',
  'vanderhoof': 'Area: Leaside',
  'laird': 'Area: Leaside',

  // Bayview / North Toronto
  'bayview': 'Area: Bayview',
  'broadway ave': 'Area: Bayview',
  'glenayr': 'Area: Bayview',
  'manor rd': 'Area: Bayview',

  // Don Mills / Flemingdon
  'don mills': 'Area: Don Mills',
  'flemingdon': 'Area: Don Mills',
  'gateway': 'Area: Don Mills',

  // Downtown Core
  'king st': 'Area: Downtown',
  'queen st': 'Area: Downtown',
  'richmond st': 'Area: Downtown',
  'adelaide st': 'Area: Downtown',
  'front st': 'Area: Downtown',
  'wellington st': 'Area: Downtown',
  'bay st': 'Area: Downtown',
  'yonge st': 'Area: Downtown',
  'university ave': 'Area: Downtown',
  'peter st': 'Area: Downtown',
  'john st': 'Area: Downtown',
  'simcoe st': 'Area: Downtown',
  'blue jays way': 'Area: Downtown',

  // King West / Liberty Village
  'liberty village': 'Area: King West',
  'atlantic ave': 'Area: King West',
  'dufferin st': 'Area: King West',
  'shaw st': 'Area: King West',
  'sudbury': 'Area: King West',
  'niagara': 'Area: King West',
  'tecumseth': 'Area: King West',

  // Queen West / Ossington
  'ossington': 'Area: Queen West',
  'beaconsfield': 'Area: Queen West',
  'dovercourt': 'Area: Queen West',
  'westmoreland': 'Area: Queen West',
  'harrison': 'Area: Queen West',
  'fennings': 'Area: Queen West',

  // Leslieville / East End
  'leslieville': 'Area: Leslieville',
  'queen st e': 'Area: Leslieville',
  'eastern ave': 'Area: Leslieville',
  'jones ave': 'Area: Leslieville',
  'greenwood': 'Area: Leslieville',
  'hamilton st': 'Area: Leslieville',
  'carlaw': 'Area: Leslieville',
  'pape': 'Area: Leslieville',

  // Riverdale / Playter Estates
  'riverdale': 'Area: Riverdale',
  'broadview': 'Area: Riverdale',
  'logan': 'Area: Riverdale',
  'langley': 'Area: Riverdale',
  'playter': 'Area: Riverdale',
  'jackman': 'Area: Riverdale',
  'hogarth': 'Area: Riverdale',

  // Cabbagetown
  'cabbagetown': 'Area: Cabbagetown',
  'carlton st': 'Area: Cabbagetown',
  'ontario st': 'Area: Cabbagetown',
  'sackville': 'Area: Cabbagetown',
  'sumach': 'Area: Cabbagetown',
  'amelia': 'Area: Cabbagetown',
  'wellesley st e': 'Area: Cabbagetown',

  // St Lawrence / Distillery
  'distillery': 'Area: St Lawrence',
  'parliament st': 'Area: St Lawrence',
  'berkeley': 'Area: St Lawrence',
  'market st': 'Area: St Lawrence',
  'scott st': 'Area: St Lawrence',

  // Harbourfront / Waterfront
  'harbourfront': 'Area: Waterfront',
  'lake shore': 'Area: Waterfront',
  'queens quay': 'Area: Waterfront',
  'harbour sq': 'Area: Waterfront',
  'stadium rd': 'Area: Waterfront',

  // Trinity Bellwoods / Little Portugal
  'trinity bellwoods': 'Area: Trinity Bellwoods',
  'crawford': 'Area: Trinity Bellwoods',
  'euclid': 'Area: Trinity Bellwoods',
  'palmerston': 'Area: Trinity Bellwoods',
  'clinton': 'Area: Trinity Bellwoods',
  'grace': 'Area: Trinity Bellwoods',
  'bellwoods': 'Area: Trinity Bellwoods',

  // Etobicoke
  'etobicoke': 'Area: Etobicoke',
  'humber': 'Area: Etobicoke',
  'islington': 'Area: Etobicoke',
  'bloor st w etobicoke': 'Area: Etobicoke',
  'kipling': 'Area: Etobicoke',
  'royal york': 'Area: Etobicoke',
  'kingsway': 'Area: Etobicoke',
  'prince edward': 'Area: Etobicoke',

  // North York
  'north york': 'Area: North York',
  'sheppard': 'Area: North York',
  'finch': 'Area: North York',
  'willowdale': 'Area: North York',
  'mel lastman': 'Area: North York',
  'yonge blvd': 'Area: North York',
  'bedford park': 'Area: North York',
  'glencairn': 'Area: North York',
  'ave rd n': 'Area: North York',

  // Scarborough
  'scarborough': 'Area: Scarborough',
  'kingston rd': 'Area: Scarborough',
  'morningside': 'Area: Scarborough',
  'ellesmere': 'Area: Scarborough',
  'markham rd': 'Area: Scarborough',
  'progress ave': 'Area: Scarborough',

  // Midtown condos / St Clair
  'yonge and eg': 'Area: Midtown',
  'yonge-eglinton': 'Area: Midtown',
  'eglinton ave': 'Area: Midtown',

  // GTA / Suburbs
  'markham': 'Area: GTA',
  'richmond hill': 'Area: GTA',
  'vaughan': 'Area: GTA',
  'thornhill': 'Area: GTA',
  'oakville': 'Area: GTA',
  'mississauga': 'Area: GTA',
  'brampton': 'Area: GTA',
  'aurora': 'Area: GTA',
  'newmarket': 'Area: GTA',
  'pickering': 'Area: GTA',
  'ajax': 'Area: GTA',
  'whitby': 'Area: GTA',
  'oshawa': 'Area: GTA',
  'burlington': 'Area: GTA',
  'hamilton': 'Area: GTA',
  'barrie': 'Area: Out Of Town',
  'kingston': 'Area: Out Of Town',
  'ottawa': 'Area: Out Of Town',
  'montreal': 'Area: Out Of Town',
  'vancouver': 'Area: Out Of Town',
  'calgary': 'Area: Out Of Town',
};

/**
 * Get area tag from a property address
 * Returns e.g. "Area: Forest Hill" or null
 */
function getAreaFromAddress(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const [key, area] of Object.entries(TORONTO_AREAS)) {
    if (lower.includes(key)) return area;
  }
  return null;
}

/**
 * Get street tag from a property address
 * Returns e.g. "Street: Lawrence Ave W" or null
 */
function getStreetFromAddress(address) {
  if (!address) return null;
  // Extract street name — match common patterns
  // e.g. "123 Lawrence Ave W, Toronto" → "Lawrence Ave W"
  const match = address.match(/^\d+[-\w]?\s+(.+?)(?:,|\s+(?:Toronto|ON|Ontario|Unit|Suite|#))/i);
  if (match) {
    const street = match[1].trim()
      .replace(/\s+/g, ' ')
      .replace(/\b(st|ave|rd|blvd|dr|crt|cres|pl|way|ln|terr|terrace|pkwy|hwy)\b\.?$/i, (m) => {
        const map = {st:'St',ave:'Ave',rd:'Rd',blvd:'Blvd',dr:'Dr',crt:'Crt',cres:'Cres',pl:'Pl',way:'Way',ln:'Ln',terr:'Terr',terrace:'Terrace',pkwy:'Pkwy',hwy:'Hwy'};
        return map[m.toLowerCase().replace('.','')]  || m;
      });
    return `Street: ${street}`;
  }
  return null;
}

module.exports = { getAreaFromAddress, getStreetFromAddress, TORONTO_AREAS };
