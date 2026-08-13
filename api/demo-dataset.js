// Shared demo dataset + seeder for the Demo Agent account.
// Not an endpoint — required by seed-demo-agent.js and demo-login.js.
//
// ALL DATA HERE IS FICTIONAL. It is modeled on the SHAPE of a real Toronto
// agent's book (sales + leases across years, a neighbourhood farm cluster,
// repeat clients/households, FINTRAC coverage, lease-renewal windows) so the
// demo tells the true product story without exposing any real client.

const DEMO_AGENT_ID = 'agent_demo';
const DEMO_SEED_VERSION = 'v2-2026-08-13';

// tag(tag, confidence, reason) → suggested_tags entry
const t = (tag, confidence, reason) => ({ tag, confidence, reason });

// ── Contacts ──────────────────────────────────────────────────────────
// suggested_tags: objects (UI renders chips + tooltips); approved_tags: strings.
const CONTACTS = [
  {
    full_name: 'Sarah Mitchell', email: 'sarah.mitchell@gmail.com', phone: '416-555-0142',
    job_title: 'Marketing Director', company: 'Shopify', birthday: '1988-03-15',
    location: 'Leslieville', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Buyer','high','Actively searching with pre-approval'), t('Pre-Approved','high','Pre-approved at $850K'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Marketing','high','Marketing Director at Shopify'), t('Timeline: 3-6 Months','medium','Wants to close before winter')],
    approved_tags: ['Buyer','Pre-Approved','Age: 30s','Profession: Marketing','Timeline: 3-6 Months'],
    notes: 'First time buyer. Pre-approved at $850K. Looking in Leslieville and Riverside.'
  },
  {
    full_name: 'James & Priya Okonkwo', email: 'jokonkwo@rbc.com', phone: '416-555-0287',
    job_title: 'Senior Analyst', company: 'RBC Capital Markets', birthday: '1983-07-22', spouse_name: 'Priya Okonkwo',
    location: 'Humewood-Cedarvale', city: 'Toronto', fintrac_verified: true, pushed: true,
    suggested_tags: [t('Past Client','high','Sold Sorauren semi + bought Humewood Dr with us'), t('Age: 40s','high','Calculated from birthday (FINTRAC)'), t('Profession: Finance','high','Senior Analyst at RBC Capital Markets'), t('Homeowner','high','Owns 45 Humewood Dr'), t('Upsizer','high','Sold semi, bought detached 2024'), t('Has Referred','medium','Referred the Hosseinis')],
    approved_tags: ['Past Client','Age: 40s','Profession: Finance','Homeowner','Upsizer','Has Referred'],
    notes: 'Sold their Sorauren semi Feb 2024, bought 45 Humewood Dr June 2024 (double client). Anniversary touch due June.'
  },
  {
    full_name: 'Michael Chen', email: 'mchen@osler.com', phone: '647-555-0318',
    job_title: 'Associate Lawyer', company: 'Osler LLP', birthday: '1991-11-08',
    location: 'King West', city: 'Toronto', fintrac_verified: true, pushed: true,
    suggested_tags: [t('Past Client','high','Bought King West condo 2021'), t('Age: 30s','high','Calculated from birthday (FINTRAC)'), t('Profession: Legal','high','Associate at Osler LLP'), t('Condo Owner','high','Owns 560 King St W unit'), t('High Equity Owner','medium','Bought 2021, strong appreciation'), t('Likely Seller','medium','Owner 4-6 yrs — upsize window')],
    approved_tags: ['Past Client','Age: 30s','Profession: Legal','Condo Owner','High Equity Owner','Likely Seller'],
    notes: 'Bought 2-bed at 560 King St W in 2021. In the 4-6 year ownership window — natural upsize conversation.'
  },
  {
    full_name: 'Grace Nakamura', email: 'g.nakamura@tdsb.on.ca', phone: '416-555-0930',
    job_title: 'High School Teacher', company: 'TDSB', birthday: '1987-10-05',
    location: 'Humewood-Cedarvale', city: 'Toronto', fintrac_verified: true, pushed: true,
    suggested_tags: [t('Past Client','high','Two purchases with us (2021, 2025)'), t('Age: 30s','high','Calculated from birthday (FINTRAC)'), t('Profession: Education','high','Teacher at TDSB'), t('Homeowner','high','Owns 98 Vaughan Rd'), t('Investment Owner','medium','Kept Duplex Ave condo as rental')],
    approved_tags: ['Past Client','Age: 30s','Profession: Education','Homeowner','Investment Owner'],
    notes: 'REPEAT client — bought Duplex Ave condo 2021, upsized to 98 Vaughan Rd 2025 and kept the condo as a rental.'
  },
  {
    full_name: 'Amir & Leila Hosseini', email: 'amir.hosseini@gmail.com', phone: '647-555-0455',
    job_title: 'Master Electrician', company: 'Hosseini Electric', birthday: '1984-01-19', spouse_name: 'Leila Hosseini',
    location: 'Humewood-Cedarvale', city: 'Toronto', fintrac_verified: true, pushed: true,
    suggested_tags: [t('Past Client','high','Bought 121 Winnett Ave 2020'), t('Age: 40s','high','Calculated from birthday (FINTRAC)'), t('Profession: Trades','high','Master Electrician, own company'), t('Homeowner','high','Owns Winnett Ave semi'), t('Open To Reno','medium','Renovating basement themselves')],
    approved_tags: ['Past Client','Age: 40s','Profession: Trades','Homeowner','Open To Reno'],
    notes: 'Bought 121 Winnett Ave Aug 2020 — referred by the Okonkwos. Owner 6 yrs — equity check-in due.'
  },
  {
    full_name: 'Olivia & Marcus Grant', email: 'dr.ogrant@gmail.com', phone: '416-555-0611',
    job_title: 'Family Physician', company: 'St. Clair West Medical', birthday: '1980-06-11', spouse_name: 'Marcus Grant',
    location: 'Humewood-Cedarvale', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Sold 174 Arlington Ave 2022'), t('Age: 40s','high','Calculated from birthday'), t('Profession: Healthcare','high','Family Physician, St. Clair West'), t('Sphere','medium','Active in Humewood school community')],
    approved_tags: ['Past Client','Age: 40s','Profession: Healthcare','Sphere'],
    notes: 'Sold 174 Arlington Ave March 2022. Moved to Oakville — still refer Humewood neighbours.'
  },
  {
    full_name: 'Natasha Kowalski', email: 'n.kowalski@td.com', phone: '647-555-0674',
    job_title: 'Branch Manager', company: 'TD Bank', birthday: '1990-01-25',
    location: 'Liberty Village', city: 'Toronto', fintrac_verified: true, pushed: true,
    suggested_tags: [t('Past Client','high','Sold Fort York condo 2023'), t('Age: 30s','high','Calculated from birthday (FINTRAC)'), t('Profession: Finance','high','Branch Manager at TD'), t('Investment Owner','medium','Owns rental property in Hamilton'), t('Likely Buyer','medium','Mentioned wanting back into the Toronto market')],
    approved_tags: ['Past Client','Age: 30s','Profession: Finance','Investment Owner','Likely Buyer'],
    notes: 'Sold 219 Fort York Blvd unit April 2023. Watching the market to buy back in — check quarterly.'
  },
  {
    full_name: 'Tyler Marchetti', email: 'tyler.m@gmail.com', phone: '416-555-0789',
    job_title: 'Product Manager', company: 'Wealthsimple', birthday: '1994-06-18',
    location: 'Liberty Village', city: 'Toronto', fintrac_verified: true, pushed: true,
    suggested_tags: [t('Past Client','high','Bought Joe Shuster Way condo 2022'), t('Age: 30s','high','Calculated from birthday (FINTRAC)'), t('Profession: Tech','high','Product Manager at Wealthsimple'), t('Condo Owner','high','Owns 38 Joe Shuster Way unit')],
    approved_tags: ['Past Client','Age: 30s','Profession: Tech','Condo Owner'],
    notes: 'Bought at 38 Joe Shuster Way July 2022. Owner 4 yrs — in the upsize window.'
  },
  {
    full_name: 'Linda & Frank Petrov', email: 'lpetrov@hotmail.com', phone: '416-555-0812',
    job_title: 'Retired', company: '', birthday: '1952-04-03', spouse_name: 'Frank Petrov',
    location: 'Etobicoke', city: 'Toronto', fintrac_verified: true, pushed: true,
    suggested_tags: [t('Past Client','high','Sold North York home + bought Palace Pier condo 2019'), t('Age: 60+','high','Calculated from birthday (FINTRAC)'), t('Downsizer','high','Completed downsize 2019'), t('Empty Nesters','high','Kids grown and moved out'), t('High Equity Owner','high','Mortgage-free condo'), t('Has Referred','high','Referred Robert Ilnicki')],
    approved_tags: ['Past Client','Age: 60+','Downsizer','Empty Nesters','High Equity Owner','Has Referred'],
    notes: 'DOUBLE-ENDED household 2019: sold 88 Burnett Ave, bought Palace Pier condo. Check in every 6 months.'
  },
  {
    full_name: 'Robert Ilnicki', email: 'r.ilnicki@rogers.com', phone: '416-555-1177',
    job_title: 'Retired', company: '', birthday: '1958-02-27',
    location: 'Leslieville', city: 'Toronto', fintrac_verified: false, pushed: false,
    suggested_tags: [t('Seller','high','Listed 25 Cherry Nook Gdns, closed June 2025'), t('Age: 60+','high','Calculated from birthday'), t('Downsizer','high','Selling family home'), t('Sphere','medium','Referred by the Petrovs')],
    approved_tags: ['Seller','Age: 60+','Downsizer','Sphere'],
    notes: 'Sold 25 Cherry Nook Gdns June 2025 (referred by Petrovs). Renting while deciding next move — buyer opportunity.'
  },
  {
    full_name: 'Victor Antonopoulos', email: 'victor@antonproperties.ca', phone: '416-555-0388',
    job_title: 'Business Owner', company: 'Anton Properties', birthday: '1969-07-30',
    location: 'CityPlace', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','3 lease deals on his units since 2022'), t('Age: 50s','high','Calculated from birthday'), t('Profession: Business Owner','high','Owns Anton Properties'), t('Investment Owner','high','Owns 2 CityPlace rental condos'), t('Landlord','high','Repeat landlord — Iceboat Terr + Fort York Blvd')],
    approved_tags: ['Past Client','Age: 50s','Profession: Business Owner','Investment Owner'],
    notes: 'REPEAT LANDLORD — we have leased 15 Iceboat Terr #3307 three times (2022, 2023, 2025) and 209 Fort York #872 once. Next renewal spring 2026.'
  },
  {
    full_name: 'Sofia Ramirez', email: 'sofia.ramirez@figma.com', phone: '647-555-0244',
    job_title: 'UX Designer', company: 'Figma', birthday: '1993-04-12',
    location: 'King West', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Two leases with us (2021, 2024)'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Tech','high','UX Designer at Figma'), t('Likely Buyer','high','Repeat tenant, rising income — buyer conversation due')],
    approved_tags: ['Past Client','Age: 30s','Profession: Tech','Likely Buyer'],
    notes: 'REPEAT tenant — leased East Liberty 2021, upgraded to Adelaide St W 2024. Lease anniversary Aug — renewal/buy conversation.'
  },
  {
    full_name: 'Kevin Park', email: 'kpark@shopify.com', phone: '647-555-0923',
    job_title: 'Software Engineer', company: 'Shopify', birthday: '1996-02-14',
    location: 'Annex', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Leased Huron St unit Sept 2023'), t('Buyer','high','Now pre-qualifying to buy'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Tech','high','Software Engineer at Shopify'), t('First Time Buyer','high','Tenant-to-buyer pipeline'), t('Timeline: 6-12 Months','medium','Lease ends spring 2026')],
    approved_tags: ['Past Client','Buyer','Age: 30s','Profession: Tech','First Time Buyer','Timeline: 6-12 Months'],
    notes: 'TENANT-TO-BUYER story: leased 485 Huron St Sept 2023, now exploring buying before lease ends spring 2026.'
  },
  {
    full_name: 'Hannah Liu', email: 'hannah.liu@uhn.ca', phone: '416-555-0533',
    job_title: 'Registered Nurse', company: 'UHN Toronto General', birthday: '1995-09-03',
    location: 'CityPlace', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Leased Iceboat Terr unit 2022'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Healthcare','high','RN at Toronto General'), t('Nurture','medium','Moved to Vancouver 2023 — may return')],
    approved_tags: ['Past Client','Age: 30s','Profession: Healthcare','Nurture'],
    notes: 'Leased 15 Iceboat Terr 2022, relocated 2023. Keep warm — hospital transfer back is possible.'
  },
  {
    full_name: 'Dmitri Volkov', email: 'd.volkov@scotiabank.com', phone: '647-555-0810',
    job_title: 'Data Scientist', company: 'Scotiabank', birthday: '1989-12-08',
    location: 'CityPlace', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Leased Iceboat Terr unit 2023'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Tech','high','Data Scientist at Scotiabank'), t('Likely Buyer','medium','Tenant 2+ yrs, stable income')],
    approved_tags: ['Past Client','Age: 30s','Profession: Tech','Likely Buyer'],
    notes: 'Tenant at 15 Iceboat Terr since July 2023 — 3 years in place next summer. Buyer conversation candidate.'
  },
  {
    full_name: 'Amara Diallo', email: 'amara.diallo@rexall.ca', phone: '416-555-0699',
    job_title: 'Pharmacist', company: 'Rexall', birthday: '1992-05-21',
    location: 'Fort York', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Leased Fort York unit May 2024'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Healthcare','high','Pharmacist at Rexall'), t('Timeline: 12+ Months','medium','Renewal window spring 2026')],
    approved_tags: ['Past Client','Age: 30s','Profession: Healthcare','Timeline: 12+ Months'],
    notes: 'Tenant at 209 Fort York Blvd #872 (Victor’s unit) since May 2024 — renewal window opens spring 2026.'
  },
  {
    full_name: 'Ben Wasserman', email: 'bwasserman@blakes.com', phone: '647-555-0166',
    job_title: 'Paralegal', company: 'Blakes', birthday: '1997-01-15',
    location: 'Entertainment District', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Leased Widmer St unit Nov 2024'), t('Age: 20s','high','Calculated from birthday'), t('Profession: Legal','high','Paralegal at Blakes'), t('Nurture','medium','21 months to renewal window')],
    approved_tags: ['Past Client','Age: 20s','Profession: Legal','Nurture'],
    notes: 'Leased 21 Widmer St Nov 2024. Renewal fall 2026.'
  },
  {
    full_name: 'Chloe Tremblay', email: 'chloe.tremblay@vice.com', phone: '438-555-0912',
    job_title: 'Marketing Coordinator', company: 'Vice Media', birthday: '1998-11-27',
    location: 'Fort York', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Past Client','high','Leased Fort York unit Feb 2025'), t('Age: 20s','high','Calculated from birthday'), t('Profession: Marketing','high','Marketing Coordinator at Vice'), t('Nurture','medium','New to Toronto from Montreal')],
    approved_tags: ['Past Client','Age: 20s','Profession: Marketing','Nurture'],
    notes: 'Leased 170 Fort York Blvd Feb 2025. Moved from Montreal.'
  },
  {
    full_name: 'Priyanka Shah', email: 'priyanka.shah@kpmg.ca', phone: '416-555-0277',
    job_title: 'Accountant', company: 'KPMG', birthday: '1991-08-14',
    location: 'CityPlace', city: 'Toronto', fintrac_verified: false, pushed: false,
    suggested_tags: [t('Past Client','high','Leased Iceboat Terr unit May 2025'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Finance','high','Accountant at KPMG')],
    approved_tags: ['Past Client','Age: 30s','Profession: Finance'],
    notes: 'Newest tenant at 15 Iceboat Terr #3307 (third tenant we’ve placed in Victor’s unit).'
  },
  {
    full_name: 'Marcus Oyelaran', email: 'm.oyelaran@deloitte.ca', phone: '416-555-0344',
    job_title: 'Management Consultant', company: 'Deloitte', birthday: '1994-03-09',
    location: 'Harbourfront', city: 'Toronto', fintrac_verified: false, pushed: false,
    suggested_tags: [t('Past Client','high','Leased York St unit July 2025'), t('Age: 30s','high','Calculated from birthday'), t('Timeline: 12+ Months','medium','Renewal summer 2026')],
    approved_tags: ['Past Client','Age: 30s','Timeline: 12+ Months'],
    notes: 'Leased 12 York St #3506 July 2025.'
  },
  {
    full_name: 'David & Karen Rosenberg', email: 'd.rosenberg@gmail.com', phone: '416-555-0563',
    job_title: 'Business Owner', company: 'Rosenberg & Associates', birthday: '1965-09-12', spouse_name: 'Karen Rosenberg',
    location: 'Forest Hill', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Sphere','high','Long-time referrers'), t('Downsizer','medium','Talking about downsizing in 2-3 yrs'), t('Age: 60+','high','Calculated from birthday'), t('Profession: Business Owner','high','Owns Rosenberg & Associates'), t('High Equity Owner','high','Forest Hill detached, mortgage-free'), t('Has Referred','high','Referred 2 clients last year')],
    approved_tags: ['Sphere','Downsizer','Age: 60+','Profession: Business Owner','High Equity Owner','Has Referred'],
    notes: 'Top referrers. Forest Hill home — future downsize listing (est. $3M+). Dinner twice a year.'
  },
  {
    full_name: 'Emma Beausoleil', email: 'emma.b@gmail.com', phone: '416-555-0451',
    job_title: 'Physiotherapist', company: 'Runnymede Healthcare', birthday: '1985-05-30',
    location: 'Roncesvalles', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Likely Buyer','high','Renter ready to buy'), t('First Time Buyer','high','Never owned'), t('Age: 40s','high','Calculated from birthday'), t('Profession: Healthcare','high','Physiotherapist at Runnymede'), t('Timeline: 6-12 Months','medium','Saving final downpayment')],
    approved_tags: ['Likely Buyer','First Time Buyer','Age: 40s','Profession: Healthcare','Timeline: 6-12 Months'],
    notes: 'Long-time Roncesvalles renter, ~$700K condo budget.'
  },
  {
    full_name: 'Alicia Torres', email: 'a.torres@sunlife.com', phone: '416-555-1034',
    job_title: 'Financial Advisor', company: 'Sun Life', birthday: '1979-08-22',
    location: 'Scarborough', city: 'Toronto', fintrac_verified: false, pushed: false,
    suggested_tags: [t('Seller','high','Inherited property to sell'), t('Age: 40s','high','Calculated from birthday'), t('Profession: Finance','high','Financial Advisor at Sun Life'), t('Would Buy For Right Price','medium','Open to trading up downtown')],
    approved_tags: ['Seller','Age: 40s','Profession: Finance','Would Buy For Right Price'],
    notes: 'Inherited a Scarborough bungalow — listing conversation scheduled. Birthday next week: Aug 22.'
  },
  {
    full_name: 'Dustin Seidler', email: 'dustin@dustinseidler.ca', phone: '416-200-7177',
    job_title: 'Sales Representative', company: 'Chestnut Park Real Estate', birthday: '1992-07-04',
    location: 'Yorkville', city: 'Toronto', fintrac_verified: false, pushed: true,
    suggested_tags: [t('Sphere','high','Agent-to-agent referral partner'), t('Profession: Real Estate Agent','high','Sales Rep at Chestnut Park'), t('Age: 30s','high','Calculated from birthday'), t('Has Referred','high','Sent two Yorkville leads')],
    approved_tags: ['Sphere','Profession: Real Estate Agent','Age: 30s','Has Referred'],
    notes: 'Yorkville specialist at Chestnut Park — referral partner, sends leads outside his farm.'
  },
  // ── sparse contacts: feed the Voice review list + "Needs Review" filter ──
  { full_name: 'Paul Whitfield', email: '', phone: '', job_title: '', company: '', location: 'Toronto', city: 'Toronto', pushed: false, suggested_tags: [], approved_tags: ['Not Enriched'], notes: '' },
  { full_name: 'Maria Santos', email: '', phone: '', job_title: '', company: '', location: '', city: 'Toronto', pushed: false, suggested_tags: [], approved_tags: ['Not Enriched'], notes: '' },
  { full_name: 'Jenna', email: '', phone: '', job_title: '', company: '', location: '', city: 'Toronto', pushed: false, suggested_tags: [], approved_tags: [], notes: '' },
];

// ── Trades ────────────────────────────────────────────────────────────
// Sales: agent_share_pretax ≈ 2.5% of price. Leases: half month's rent (pretax),
// deposit = first + last. _pushStatus 'pushed' renders the green FUB badge.
const TRADES = [
  // 2019 — the Petrov double-ended downsize
  { deal_type: 'sale', property_address: '88 Burnett Ave, North York ON', buyer_or_tenant_name: 'Outside Buyer', seller_or_landlord_name: 'Linda & Frank Petrov', agent_side: 'seller', close_date: '2019-06-28', sale_price: 1320000, deposit: 66000, agent_share_pretax: 33000, _pushStatus: 'pushed', _fubDealId: 90311 },
  { deal_type: 'sale', property_address: '1 Palace Pier Crt Unit 2306, Etobicoke ON', buyer_or_tenant_name: 'Linda & Frank Petrov', seller_or_landlord_name: 'Outside Seller', agent_side: 'buyer', close_date: '2019-11-30', sale_price: 712000, deposit: 35600, agent_share_pretax: 17800, _pushStatus: 'pushed', _fubDealId: 90312 },
  // 2020-2022 — Humewood farm + condo buyers
  { deal_type: 'sale', property_address: '121 Winnett Ave, Toronto ON', buyer_or_tenant_name: 'Amir & Leila Hosseini', seller_or_landlord_name: 'Outside Seller', agent_side: 'buyer', close_date: '2020-08-14', sale_price: 1145000, deposit: 57250, agent_share_pretax: 28625, _pushStatus: 'pushed', _fubDealId: 90340 },
  { deal_type: 'sale', property_address: '411 Duplex Ave Unit 1804, Toronto ON', buyer_or_tenant_name: 'Grace Nakamura', seller_or_landlord_name: 'Outside Seller', agent_side: 'buyer', close_date: '2021-04-09', sale_price: 638000, deposit: 31900, agent_share_pretax: 15950, _pushStatus: 'pushed', _fubDealId: 90355 },
  { deal_type: 'lease', property_address: '85 East Liberty St Unit 1509, Toronto ON', buyer_or_tenant_name: 'Sofia Ramirez', seller_or_landlord_name: 'Outside Landlord', agent_side: 'tenant', close_date: '2021-05-01', monthly_rent: 2150, deposit: 4300, agent_share_pretax: 1075, _pushStatus: 'pushed', _fubDealId: 90360 },
  { deal_type: 'sale', property_address: '560 King St W Unit 812, Toronto ON', buyer_or_tenant_name: 'Michael Chen', seller_or_landlord_name: 'Outside Seller', agent_side: 'buyer', close_date: '2021-09-15', sale_price: 785000, deposit: 39250, agent_share_pretax: 19625, _pushStatus: 'pushed', _fubDealId: 90371 },
  { deal_type: 'sale', property_address: '174 Arlington Ave, Toronto ON', buyer_or_tenant_name: 'Outside Buyer', seller_or_landlord_name: 'Olivia & Marcus Grant', agent_side: 'seller', close_date: '2022-03-31', sale_price: 1395000, deposit: 69750, agent_share_pretax: 34875, _pushStatus: 'pushed', _fubDealId: 90384 },
  { deal_type: 'lease', property_address: '15 Iceboat Terr Unit 3307, Toronto ON', buyer_or_tenant_name: 'Hannah Liu', seller_or_landlord_name: 'Victor Antonopoulos', agent_side: 'landlord', close_date: '2022-06-01', monthly_rent: 2350, deposit: 4700, agent_share_pretax: 1175, _pushStatus: 'pushed', _fubDealId: 90390 },
  { deal_type: 'sale', property_address: '38 Joe Shuster Way Unit 2010, Toronto ON', buyer_or_tenant_name: 'Tyler Marchetti', seller_or_landlord_name: 'Outside Seller', agent_side: 'buyer', close_date: '2022-07-10', sale_price: 598000, deposit: 29900, agent_share_pretax: 14950, _pushStatus: 'pushed', _fubDealId: 90395 },
  // 2023 — Kowalski exit, Iceboat re-lease, Kevin's Annex lease
  { deal_type: 'sale', property_address: '219 Fort York Blvd Unit 1209, Toronto ON', buyer_or_tenant_name: 'Outside Buyer', seller_or_landlord_name: 'Natasha Kowalski', agent_side: 'seller', close_date: '2023-04-28', sale_price: 649000, deposit: 32450, agent_share_pretax: 16225, _pushStatus: 'pushed', _fubDealId: 90410 },
  { deal_type: 'lease', property_address: '15 Iceboat Terr Unit 3307, Toronto ON', buyer_or_tenant_name: 'Dmitri Volkov', seller_or_landlord_name: 'Victor Antonopoulos', agent_side: 'landlord', close_date: '2023-07-15', monthly_rent: 2600, deposit: 5200, agent_share_pretax: 1300, _pushStatus: 'pushed', _fubDealId: 90419 },
  { deal_type: 'lease', property_address: '485 Huron St Unit 3, Toronto ON', buyer_or_tenant_name: 'Kevin Park', seller_or_landlord_name: 'Outside Landlord', agent_side: 'tenant', close_date: '2023-09-01', monthly_rent: 2450, deposit: 4900, agent_share_pretax: 1225, _pushStatus: 'pushed', _fubDealId: 90424 },
  // 2024 — Okonkwo sell + upsize (double), more leases
  { deal_type: 'sale', property_address: '66 Sorauren Ave, Toronto ON', buyer_or_tenant_name: 'Outside Buyer', seller_or_landlord_name: 'James & Priya Okonkwo', agent_side: 'seller', close_date: '2024-02-14', sale_price: 1285000, deposit: 64250, agent_share_pretax: 32125, _pushStatus: 'pushed', _fubDealId: 90436 },
  { deal_type: 'lease', property_address: '209 Fort York Blvd Unit 872, Toronto ON', buyer_or_tenant_name: 'Amara Diallo', seller_or_landlord_name: 'Victor Antonopoulos', agent_side: 'landlord', close_date: '2024-05-01', monthly_rent: 2750, deposit: 5500, agent_share_pretax: 1375, _pushStatus: 'pushed', _fubDealId: 90441 },
  { deal_type: 'sale', property_address: '45 Humewood Dr, Toronto ON', buyer_or_tenant_name: 'James & Priya Okonkwo', seller_or_landlord_name: 'Outside Seller', agent_side: 'buyer', close_date: '2024-06-21', sale_price: 1610000, deposit: 80500, agent_share_pretax: 40250, _pushStatus: 'pushed', _fubDealId: 90448 },
  { deal_type: 'lease', property_address: '501 Adelaide St W Unit 1108, Toronto ON', buyer_or_tenant_name: 'Sofia Ramirez', seller_or_landlord_name: 'Outside Landlord', agent_side: 'tenant', close_date: '2024-08-01', monthly_rent: 2900, deposit: 5800, agent_share_pretax: 1450, _pushStatus: 'pushed', _fubDealId: 90455 },
  { deal_type: 'lease', property_address: '21 Widmer St Unit 1902, Toronto ON', buyer_or_tenant_name: 'Ben Wasserman', seller_or_landlord_name: 'Outside Landlord', agent_side: 'tenant', close_date: '2024-11-15', monthly_rent: 2550, deposit: 5100, agent_share_pretax: 1275, _pushStatus: 'pushed', _fubDealId: 90463 },
  // 2025 — Nakamura upsize, Leslieville listing, newest leases
  { deal_type: 'lease', property_address: '170 Fort York Blvd Unit 1215, Toronto ON', buyer_or_tenant_name: 'Chloe Tremblay', seller_or_landlord_name: 'Outside Landlord', agent_side: 'tenant', close_date: '2025-02-01', monthly_rent: 2400, deposit: 4800, agent_share_pretax: 1200, _pushStatus: 'pushed', _fubDealId: 90471 },
  { deal_type: 'sale', property_address: '98 Vaughan Rd, Toronto ON', buyer_or_tenant_name: 'Grace Nakamura', seller_or_landlord_name: 'Outside Seller', agent_side: 'buyer', close_date: '2025-03-07', sale_price: 1240000, deposit: 62000, agent_share_pretax: 31000, _pushStatus: 'pushed', _fubDealId: 90476 },
  { deal_type: 'lease', property_address: '15 Iceboat Terr Unit 3307, Toronto ON', buyer_or_tenant_name: 'Priyanka Shah', seller_or_landlord_name: 'Victor Antonopoulos', agent_side: 'landlord', close_date: '2025-05-01', monthly_rent: 2825, deposit: 5650, agent_share_pretax: 1412.5 },
  { deal_type: 'sale', property_address: '25 Cherry Nook Gdns, Toronto ON', buyer_or_tenant_name: 'Outside Buyer', seller_or_landlord_name: 'Robert Ilnicki', agent_side: 'seller', close_date: '2025-06-30', sale_price: 1050000, deposit: 52500, agent_share_pretax: 26250 },
  { deal_type: 'lease', property_address: '12 York St Unit 3506, Toronto ON', buyer_or_tenant_name: 'Marcus Oyelaran', seller_or_landlord_name: 'Outside Landlord', agent_side: 'tenant', close_date: '2025-07-15', monthly_rent: 3100, deposit: 6200, agent_share_pretax: 1550 },
];

// ── Review queue ──────────────────────────────────────────────────────
const REVIEW_ITEMS = [
  { name: 'Kathleen Moroz', reason: 'FINTRAC record with no matching contact', detail: 'From fintrac_all.csv row 41', birthday: '1979-03-18', occupation: 'Dental Hygienist', address: '', year: '' },
  { name: 'Stefan Weiss', reason: 'FINTRAC record with no matching contact', detail: 'From fintrac_all.csv row 87', birthday: '1990-12-02', occupation: 'Anesthesiologist', address: '', year: '' },
  { name: 'Jenna', reason: 'No last name on contact — needs ID', detail: 'Created from voice memo, Feb 2026', birthday: '', occupation: '', address: '', year: '' },
  { name: 'R. Duong', reason: 'Trade party not found in contacts', detail: 'Co-buyer on closed deal', birthday: '', occupation: '', address: '25 Cherry Nook Gdns', year: '2025' },
];

// ── Enrichment queue (Queue tab) ──────────────────────────────────────
const QUEUE_ITEMS = [
  {
    id: 'demoq_sarah', name: 'Sarah Mitchell', city: 'Toronto', email: 'sarah.mitchell@gmail.com', status: 'done',
    approved_tags: ['Buyer','Pre-Approved','Age: 30s','Profession: Marketing'],
    result: {
      full_name: 'Sarah Mitchell', initials: 'SM', job_title: 'Marketing Director', company: 'Shopify',
      location: 'Toronto', confidence_overall: 'high', warning: null,
      suggested_tags: [t('Buyer','high','Actively searching, pre-approved'), t('Pre-Approved','high','Pre-approved at $850K'), t('Age: 30s','high','Calculated from birthday'), t('Profession: Marketing','high','Marketing Director at Shopify'), t('Timeline: 3-6 Months','medium','Wants to close before winter')],
      notes: 'First-time buyer, pre-approved $850K, focused on Leslieville/Riverside.'
    }
  },
  {
    id: 'demoq_alicia', name: 'Alicia Torres', city: 'Toronto', email: 'a.torres@sunlife.com', status: 'done',
    approved_tags: [],
    result: {
      full_name: 'Alicia Torres', initials: 'AT', job_title: 'Financial Advisor', company: 'Sun Life',
      location: 'Toronto', confidence_overall: 'high', warning: null,
      suggested_tags: [t('Seller','high','Inherited Scarborough property to sell'), t('Age: 40s','high','Calculated from birthday'), t('Profession: Finance','high','Financial Advisor at Sun Life'), t('Would Buy For Right Price','medium','Open to trading up downtown')],
      notes: 'Inherited a Scarborough bungalow. Listing appointment booked.'
    }
  },
  {
    id: 'demoq_paul', name: 'Paul Whitfield', city: 'Toronto', email: '', status: 'review',
    approved_tags: [],
    result: {
      full_name: 'Paul Whitfield', initials: 'PW', job_title: '', company: '',
      location: 'Toronto', confidence_overall: 'low', warning: 'Multiple matches found — could not confirm identity. Review before pushing.',
      suggested_tags: [t('Nurture','low','Insufficient public data')],
      notes: ''
    }
  },
];

// ── Seeder ────────────────────────────────────────────────────────────
async function seedDemoData(redis) {
  // agent record
  await redis.set(`agent:id:${DEMO_AGENT_ID}`, JSON.stringify({
    agentId: DEMO_AGENT_ID, name: 'Demo Agent', email: 'demo@trellis.ai',
    role: 'agent', hasFubKey: false,
  }));

  // contacts (clear + reseed, deterministic ids)
  const existing = await redis.lrange(`agent:${DEMO_AGENT_ID}:contacts`, 0, -1);
  for (const id of existing) await redis.del(id);
  await redis.del(`agent:${DEMO_AGENT_ID}:contacts`);
  const now = Date.now();
  let i = 0;
  for (const contact of CONTACTS) {
    const id = `contact:${DEMO_AGENT_ID}:demo:${String(i).padStart(3, '0')}`;
    // stagger savedAt over the past weeks, oldest first, so lpush leaves newest on top
    const savedAt = new Date(now - (CONTACTS.length - i) * 36e5 * 7).toISOString();
    await redis.set(id, JSON.stringify({ ...contact, contactId: id, agentId: DEMO_AGENT_ID, enriched: true, savedAt, fub_data: { fub_id: null } }));
    await redis.lpush(`agent:${DEMO_AGENT_ID}:contacts`, id);
    i++;
  }

  // trades (clear + reseed; savedAt tracks close_date so newest deals list first)
  const existingTrades = await redis.lrange(`agent:${DEMO_AGENT_ID}:trades`, 0, -1);
  for (const id of existingTrades) await redis.del(id);
  await redis.del(`agent:${DEMO_AGENT_ID}:trades`);
  let j = 0;
  for (const trade of TRADES) {
    const tid = `trade:${DEMO_AGENT_ID}:demo:${String(j).padStart(3, '0')}`;
    await redis.set(tid, JSON.stringify({ ...trade, agentId: DEMO_AGENT_ID, source: 'demo', savedAt: trade.close_date + 'T12:00:00.000Z' }));
    await redis.lpush(`agent:${DEMO_AGENT_ID}:trades`, tid);
    j++;
  }

  // review queue
  await redis.set(`agent:${DEMO_AGENT_ID}:review_queue`, JSON.stringify(REVIEW_ITEMS.map((it, k) => ({
    id: 'demorv' + k, ...it, status: 'pending', note: '', addedAt: new Date(now - 86400e3 * (k + 1)).toISOString()
  }))));

  // enrichment queue
  await redis.set(`queue:${DEMO_AGENT_ID}`, JSON.stringify(QUEUE_ITEMS.map(q => ({ ...q, addedAt: new Date(now - 36e5 * 5).toISOString() }))));

  await redis.set(`demo:seed:version`, DEMO_SEED_VERSION);
  return { contacts: CONTACTS.length, trades: TRADES.length, reviewItems: REVIEW_ITEMS.length, queueItems: QUEUE_ITEMS.length };
}

module.exports = { DEMO_AGENT_ID, DEMO_SEED_VERSION, seedDemoData };
