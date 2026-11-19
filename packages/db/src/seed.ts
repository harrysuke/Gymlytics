import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  academySubscriptions,
  affiliations,
  academies,
  attendanceLogs,
  beltRanks,
  bookings,
  classes,
  classRecaps,
  crossTrainingPasses,
  curriculumRequirements,
  curriculumTechniques,
  curriculumVideos,
  familyLinks,
  importJobs,
  incidents,
  leads,
  memberships,
  membershipPlans,
  onboardingProgress,
  paymentRetries,
  programs,
  promotions,
  retailProducts,
  saasPlans,
  transactions,
  transactionItems,
  users,
  waiverTemplates,
  waivers,
  widgets,
} from './schema/index';
import { createDb } from './client';
import { uuidv7 } from './ids';
import { resolveDatabaseUrl } from './paths';

const ACADEMY_SLUG = 'gymlytics-demo';
const PASSWORD = 'Password123!';
const PIN = '1234';

const db = createDb(resolveDatabaseUrl());

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hashPin = (academyId: string, pin: string) => sha256(`${academyId}:${pin}`);
const iso = (date: Date) => date.toISOString();
const daysFromNow = (days: number, hour = 12, minute = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
};
const monthsAgo = (months: number) => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a production database');
}

const existing = db.select().from(academies).where(eq(academies.slug, ACADEMY_SLUG)).get();
if (existing) {
  console.log(`[seed] removing existing demo academy ${existing.id}`);
  // Branch academies reference the parent, so remove them first (SQLite does
  // not let drizzle-kit attach ON DELETE SET NULL via ALTER TABLE here).
  db.delete(academies).where(eq(academies.slug, `${ACADEMY_SLUG}-pj`)).run();
  db.delete(academies).where(eq(academies.id, existing.id)).run();
}

const academyId = uuidv7();
db.insert(academies)
  .values({
    id: academyId,
    name: 'Iron Temple Academy',
    slug: ACADEMY_SLUG,
    timezone: 'Asia/Kuala_Lumpur',
    currency: 'MYR',
    countryCode: 'MY',
    phone: '+60312345678',
    email: 'hello@irontemple.test',
    city: 'Kuala Lumpur',
    state: 'WP Kuala Lumpur',
    settings: {
      beltSystemId: 'ibjjf_adult',
      checkInPinLength: 4,
      gracePeriodDays: 7,
      waiverVersion: 1,
      autoCheckoutHours: 3,
      promoMinMonths: {},
      currencyDecimals: 2,
    },
  })
  .run();

const waiverBody = `# Participation and liability waiver

I confirm that I am physically fit to take part in martial arts training and that I have disclosed any relevant medical condition to the academy.

I understand that Brazilian Jiu-Jitsu, Muay Thai, wrestling, judo, karate and mixed martial arts involve physical contact and an inherent risk of injury. I voluntarily accept that risk and agree to follow the academy's safety rules and the coach's instructions at all times.

I agree that the academy may store my signature, the time of signing, my IP address and this document hash as evidence of consent. I may withdraw consent in writing, but doing so ends my access to the mats.

This waiver remains valid for twelve months from the date of signature.`;

db.insert(waiverTemplates)
  .values({
    id: uuidv7(),
    academyId,
    waiverType: 'general',
    version: 1,
    title: 'Participation and liability waiver',
    bodyMarkdown: waiverBody,
    documentHash: sha256(waiverBody),
  })
  .run();

db.insert(waiverTemplates)
  .values({
    id: uuidv7(),
    academyId,
    waiverType: 'dropin',
    version: 1,
    title: 'Drop-in visitor waiver',
    bodyMarkdown: `${waiverBody}\n\nThis drop-in waiver is valid for 24 hours.`,
    documentHash: sha256(`${waiverBody}\n\nThis drop-in waiver is valid for 24 hours.`),
  })
  .run();

const ownerId = uuidv7();
const coachId = uuidv7();
const staffId = uuidv7();
const guardianId = uuidv7();

// Each person gets a distinct PIN: the kiosk resolves a member by PIN hash, so
// duplicates would always check in whichever row happened to sort first.
const staffRows = [
  {
    id: ownerId,
    role: 'owner' as const,
    firstName: 'Aisha',
    lastName: 'Rahman',
    email: 'owner@gymlytics.test',
    phone: '+60123456701',
    pin: '1234',
  },
  {
    id: coachId,
    role: 'coach' as const,
    firstName: 'Marco',
    lastName: 'Silva',
    email: 'coach@gymlytics.test',
    phone: '+60123456702',
    pin: '1235',
  },
  {
    id: staffId,
    role: 'staff' as const,
    firstName: 'Nadia',
    lastName: 'Tan',
    email: 'frontdesk@gymlytics.test',
    phone: '+60123456703',
    pin: '1236',
  },
  {
    id: guardianId,
    role: 'guardian' as const,
    firstName: 'Wei',
    lastName: 'Lim',
    email: 'parent@gymlytics.test',
    phone: '+60123456704',
    pin: '1240',
  },
];

for (const { pin, ...staff } of staffRows) {
  db.insert(users)
    .values({
      ...staff,
      academyId,
      status: 'active',
      passwordHash: hashPassword(PASSWORD),
      pinHash: hashPin(academyId, pin),
      qrToken: `gym_${uuidv7().replace(/-/g, '')}`,
    })
    .run();
}

const programSeeds = [
  { name: 'Gi Brazilian Jiu-Jitsu', discipline: 'gi_bjj' as const, ageGroup: 'adult' as const, color: '#1D4ED8' },
  { name: 'No-Gi Grappling', discipline: 'nogi_bjj' as const, ageGroup: 'adult' as const, color: '#0F766E' },
  { name: 'Kids BJJ', discipline: 'kids_bjj' as const, ageGroup: 'kids' as const, color: '#D97706' },
  { name: 'Muay Thai', discipline: 'muay_thai' as const, ageGroup: 'all' as const, color: '#B91C1C' },
  { name: 'Wrestling', discipline: 'wrestling' as const, ageGroup: 'adult' as const, color: '#7C3AED' },
  { name: 'Judo', discipline: 'judo' as const, ageGroup: 'all' as const, color: '#334155' },
  { name: 'Kyokushin Karate', discipline: 'kyokushin_karate' as const, ageGroup: 'all' as const, color: '#EA580C' },
  { name: 'MMA', discipline: 'mma' as const, ageGroup: 'adult' as const, color: '#111827' },
];

const programIds: Record<string, string> = {};
const rankIds: Record<string, { white: string; blue: string; purple: string }> = {};

for (const seed of programSeeds) {
  const programId = uuidv7();
  programIds[seed.discipline] = programId;
  db.insert(programs)
    .values({
      id: programId,
      academyId,
      name: seed.name,
      slug: seed.discipline.replace(/_/g, '-'),
      discipline: seed.discipline,
      ageGroup: seed.ageGroup,
      colorHex: seed.color,
      defaultCapacity: seed.ageGroup === 'kids' ? 16 : 24,
    })
    .run();

  const ladder =
    seed.discipline === 'kids_bjj'
      ? [
          { name: 'White', slug: 'white', order: 0, color: '#FFFFFF', months: 3, classes: 12, hours: 12 },
          { name: 'Yellow', slug: 'yellow', order: 1, color: '#FACC15', months: 6, classes: 24, hours: 24 },
          { name: 'Orange', slug: 'orange', order: 2, color: '#EA580C', months: 9, classes: 36, hours: 36 },
          { name: 'Green', slug: 'green', order: 3, color: '#16A34A', months: 12, classes: 48, hours: 48 },
        ]
      : [
          { name: 'White', slug: 'white', order: 0, color: '#FFFFFF', months: 3, classes: 12, hours: 18 },
          { name: 'Blue', slug: 'blue', order: 1, color: '#1D4ED8', months: 24, classes: 96, hours: 144 },
          { name: 'Purple', slug: 'purple', order: 2, color: '#7E22CE', months: 24, classes: 120, hours: 180 },
          { name: 'Brown', slug: 'brown', order: 3, color: '#92400E', months: 18, classes: 96, hours: 144 },
          { name: 'Black', slug: 'black', order: 4, color: '#111827', months: 0, classes: 0, hours: 0 },
        ];

  const created: Record<string, string> = {};
  for (const belt of ladder) {
    const id = uuidv7();
    created[belt.slug] = id;
    db.insert(beltRanks)
      .values({
        id,
        academyId,
        programId,
        name: belt.name,
        slug: belt.slug,
        system: seed.discipline === 'kids_bjj' ? 'ibjjf_kids' : 'ibjjf_adult',
        orderIndex: belt.order,
        maxStripes: 4,
        minMonthsInRank: belt.months,
        minClassesInRank: belt.classes,
        minMatHours: belt.hours,
        colorHex: belt.color,
        stripeColorHex: '#111827',
      })
      .run();
  }
  rankIds[seed.discipline] = {
    white: created['white']!,
    blue: created['blue'] ?? created['yellow']!,
    purple: created['purple'] ?? created['orange']!,
  };
}

const giProgramId = programIds['gi_bjj']!;
const nogiProgramId = programIds['nogi_bjj']!;
const kidsProgramId = programIds['kids_bjj']!;

const techniques = [
  { name: 'Closed guard posture break', category: 'guard' as const },
  { name: 'Scissor sweep', category: 'sweep' as const },
  { name: 'Triangle choke', category: 'submission' as const },
  { name: 'Armbar from guard', category: 'submission' as const },
  { name: 'Torreando pass', category: 'pass' as const },
  { name: 'Single leg takedown', category: 'takedown' as const },
  { name: 'Hip escape', category: 'escape' as const },
  { name: 'Kimura from side control', category: 'submission' as const },
];
const techniqueIds: string[] = [];
for (const technique of techniques) {
  const id = uuidv7();
  techniqueIds.push(id);
  db.insert(curriculumTechniques)
    .values({
      id,
      academyId,
      programId: giProgramId,
      name: technique.name,
      slug: technique.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      category: technique.category,
    })
    .run();
}

// Blue belt curriculum: five required techniques drawn from the library above.
// This is what makes the "curriculum" column on the promotions screen meaningful.
const blueBeltId = rankIds['gi_bjj']!.blue;
for (const [index, techniqueId] of techniqueIds.slice(0, 5).entries()) {
  db.insert(curriculumRequirements)
    .values({
      id: uuidv7(),
      academyId,
      beltRankId: blueBeltId,
      techniqueId,
      requiredStripeLevel: 0,
      isRequired: true,
    })
    .run();
  void index;
}

const plans = [
  { name: 'Unlimited', type: 'unlimited' as const, price: 22000, perWeek: null, pack: null },
  { name: '2x per week', type: 'weekly_limit' as const, price: 16000, perWeek: 2, pack: null },
  { name: '10-class pack', type: 'class_pack' as const, price: 18000, perWeek: null, pack: 10 },
  { name: 'Family unlimited', type: 'family' as const, price: 38000, perWeek: 6, pack: null },
  { name: 'Drop-in day pass', type: 'dropin_pack' as const, price: 3500, perWeek: null, pack: 1 },
];
const planIds: string[] = [];
for (const plan of plans) {
  const id = uuidv7();
  planIds.push(id);
  db.insert(membershipPlans)
    .values({
      id,
      academyId,
      name: plan.name,
      planType: plan.type,
      billingInterval: plan.type === 'dropin_pack' ? 'one_time' : 'monthly',
      priceCents: plan.price,
      currency: 'MYR',
      classesPerWeek: plan.perWeek,
      classPackCount: plan.pack,
      familyDiscountPercent: plan.type === 'family' ? 15 : 0,
      maxDependents: plan.type === 'family' ? 4 : 0,
      freezeAllowed: plan.type !== 'dropin_pack',
    })
    .run();
}

const studentSeeds: Array<readonly [string, string, string, string]> = [
  ['Daniel', 'Ong', 'daniel@student.test', '1996-04-12'],
  ['Priya', 'Nair', 'priya@student.test', '1994-09-03'],
  ['Hafiz', 'Ismail', 'hafiz@student.test', '1991-01-22'],
  ['Mei', 'Chen', 'mei@student.test', '1999-07-30'],
  ['Arjun', 'Patel', 'arjun@student.test', '1993-11-11'],
  ['Sofia', 'Reyes', 'sofia@student.test', '1997-02-18'],
  ['Kai', 'Wong', 'kai@student.test', '2001-05-09'],
  ['Lena', 'Fischer', 'lena@student.test', '1995-08-27'],
];

const studentIds: string[] = [];
studentSeeds.forEach(([firstName, lastName, email, dob], index) => {
  const id = uuidv7();
  studentIds.push(id);
  db.insert(users)
    .values({
      id,
      academyId,
      role: 'student',
      status: index === 7 ? 'pending_waiver' : 'active',
      firstName,
      lastName,
      email,
      phone: `+6012345${String(6800 + index)}`,
      dateOfBirth: dob,
      passwordHash: hashPassword(PASSWORD),
      pinHash: hashPin(academyId, String(1200 + index)),
      qrToken: `gym_${uuidv7().replace(/-/g, '')}`,
      emergencyContactName: 'Emergency contact',
      emergencyContactPhone: '+60199999999',
    })
    .run();
});

// Two children on one guardian account — the family billing path.
const childIds: string[] = [];
for (const [firstName, dob] of [
  ['Aiden', '2014-03-15'],
  ['Chloe', '2016-10-02'],
] as const) {
  const id = uuidv7();
  childIds.push(id);
  db.insert(users)
    .values({
      id,
      academyId,
      role: 'student',
      status: 'active',
      firstName,
      lastName: 'Lim',
      dateOfBirth: dob,
      pinHash: hashPin(academyId, `77${childIds.length}0`),
      qrToken: `gym_${uuidv7().replace(/-/g, '')}`,
      notes: 'Junior program',
    })
    .run();
  db.insert(familyLinks)
    .values({
      id: uuidv7(),
      academyId,
      guardianId,
      dependentId: id,
      relationship: 'parent',
      isPrimaryBilling: true,
      canSignWaivers: true,
      canViewProgress: true,
      canBookClasses: true,
    })
    .run();
}

const allStudents = [...studentIds, ...childIds];
const waiverSignature = 'M 24 120 L 60 80 L 96 110 L 140 55 L 190 95 L 240 60 L 300 100';

// Staff sign waivers too — otherwise the owner's own PIN is blocked at the kiosk.
const waiverHolders = [ownerId, coachId, staffId, guardianId, ...allStudents];

waiverHolders.forEach((userId, index) => {
  if (index === 7) return; // pending_waiver demo member
  const child = childIds.includes(userId);
  db.insert(waivers)
    .values({
      id: uuidv7(),
      academyId,
      userId,
      programId: child ? kidsProgramId : giProgramId,
      waiverType: 'general',
      documentVersion: 1,
      documentTitle: 'Participation and liability waiver',
      documentHash: sha256(waiverBody),
      signatureData: waiverSignature,
      signatureFormat: 'svg_path',
      signerName: child ? 'Wei Lim' : 'Member',
      signerIp: '127.0.0.1',
      userAgent: 'seed-script',
      signedAt: iso(daysFromNow(-30)),
      dateOfBirthSnapshot: child ? '2014-03-15' : null,
      guardianUserId: child ? guardianId : null,
      status: 'signed',
      expiresAt: iso(daysFromNow(335)),
      hlc: `${iso(daysFromNow(-30))}-0000-seed`,
      mutationId: uuidv7(),
      syncStatus: 'synced',
    })
    .run();
});

allStudents.forEach((userId, index) => {
  const planIndex = index % 3;
  const planId = planIds[planIndex]!;
  const status = index === 5 ? 'past_due' : index === 6 ? 'frozen' : 'active';
  const membershipId = uuidv7();
  db.insert(memberships)
    .values({
      id: membershipId,
      academyId,
      userId,
      planId,
      status,
      currentPeriodStart: iso(daysFromNow(-12)),
      currentPeriodEnd: iso(daysFromNow(18)),
      classesUsedInPeriod: index % 5,
      ...(status === 'frozen'
        ? { frozenAt: iso(daysFromNow(-2)), freezeUntil: iso(daysFromNow(5)), totalFrozenDays: 7 }
        : {}),
      provider: 'manual',
      nextBillingAt: iso(daysFromNow(18)),
    })
    .run();

  db.insert(transactions)
    .values({
      id: uuidv7(),
      academyId,
      type: 'membership',
      status: status === 'past_due' ? 'failed' : 'succeeded',
      userId,
      payerId: userId,
      membershipId,
      subtotalCents: plans[planIndex]!.price,
      discountCents: 0,
      taxCents: 0,
      totalCents: plans[planIndex]!.price,
      currency: 'MYR',
      provider: 'manual',
      idempotencyKey: `seed-membership-${membershipId}`,
      processedAt: iso(daysFromNow(-12)),
    })
    .run();
});

// Promotions: everyone starts at white; a few have stripes, one is a blue belt.
allStudents.forEach((userId, index) => {
  const programId = childIds.includes(userId) ? kidsProgramId : giProgramId;
  const rank = childIds.includes(userId)
    ? rankIds['kids_bjj']!.white
    : index === 2
      ? rankIds['gi_bjj']!.blue
      : rankIds['gi_bjj']!.white;
  db.insert(promotions)
    .values({
      id: uuidv7(),
      academyId,
      userId,
      programId,
      fromBeltRankId: null,
      toBeltRankId: rank,
      fromStripes: 0,
      toStripes: index % 5,
      promotedAt: iso(monthsAgo(index === 2 ? 8 : 4)),
      promotedBy: coachId,
      classesSincePromotion: 0,
      matHoursSincePromotion: 0,
      notes: 'Seeded baseline rank',
    })
    .run();
});

const classRows: { id: string; programId: string; startsAt: string; endsAt: string }[] = [];
const weekly = [
  { day: 1, hour: 19, program: giProgramId, title: 'Gi fundamentals' },
  { day: 2, hour: 18, program: nogiProgramId, title: 'No-Gi rounds' },
  { day: 3, hour: 19, program: giProgramId, title: 'Gi advanced' },
  { day: 4, hour: 18, program: nogiProgramId, title: 'No-Gi takedowns' },
  { day: 5, hour: 19, program: giProgramId, title: 'Friday open mat' },
  { day: 6, hour: 9, program: kidsProgramId, title: 'Kids BJJ' },
  { day: 6, hour: 10, program: programIds['muay_thai']!, title: 'Muay Thai' },
  { day: 0, hour: 10, program: programIds['wrestling']!, title: 'Wrestling' },
];

// Class times are built from LOCAL wall-clock hours. Using UTC here would put a
// 19:00 class at 02:00 on a UTC+7 tablet, which looks like a broken timetable.
for (let offset = -56; offset <= 14; offset += 1) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  const weekday = date.getDay();
  for (const slot of weekly.filter((row) => row.day === weekday)) {
    const start = new Date(date);
    start.setHours(slot.hour, 0, 0, 0);
    const end = new Date(start.getTime() + 90 * 60_000);
    const id = uuidv7();
    classRows.push({ id, programId: slot.program, startsAt: iso(start), endsAt: iso(end) });
    db.insert(classes)
      .values({
        id,
        academyId,
        programId: slot.program,
        coachId: slot.program === kidsProgramId ? staffId : coachId,
        title: slot.title,
        startsAt: iso(start),
        endsAt: iso(end),
        capacity: slot.program === kidsProgramId ? 16 : 24,
        location: 'Main mat',
      })
      .run();
  }
}

// Today's demo class, anchored to the current time so the dashboard is never empty.
const demoStart = new Date(Date.now() - 60 * 60_000);
const demoEnd = new Date(Date.now() + 30 * 60_000);
const demoClassId = uuidv7();
db.insert(classes)
  .values({
    id: demoClassId,
    academyId,
    programId: giProgramId,
    coachId,
    title: 'Lunchtime Gi drilling',
    startsAt: iso(demoStart),
    endsAt: iso(demoEnd),
    capacity: 20,
    location: 'Main mat',
    bookedCount: 4,
    checkedInCount: 3,
  })
  .run();

studentIds.slice(0, 4).forEach((userId, index) => {
  const bookingId = uuidv7();
  db.insert(bookings)
    .values({
      id: bookingId,
      academyId,
      classId: demoClassId,
      userId,
      status: index < 3 ? 'checked_in' : 'booked',
      source: 'admin',
      bookedAt: iso(daysFromNow(-1)),
    })
    .run();
  if (index < 3) {
    db.insert(attendanceLogs)
      .values({
        id: uuidv7(),
        academyId,
        classId: demoClassId,
        userId,
        bookingId,
        checkedInAt: iso(new Date(demoStart.getTime() + 10 * 60_000)),
        method: 'pin',
        status: 'checked_in',
        kioskId: 'seed-kiosk',
        hlc: `${iso(demoStart)}-0000-seed`,
        originDeviceId: 'seed-kiosk',
        syncStatus: 'synced',
        mutationId: uuidv7(),
        syncedAt: iso(demoStart),
      })
      .run();
  }
});

// Historical attendance for the blue-belt candidate: 20 classes over 5 months.
const pastClasses = classRows.filter((row) => row.programId === giProgramId && new Date(row.startsAt) < new Date());
studentIds.slice(0, 3).forEach((userId, studentIndex) => {
  for (const [index, classRow] of pastClasses.slice(-20).entries()) {
    db.insert(attendanceLogs)
      .values({
        id: uuidv7(),
        academyId,
        classId: classRow.id,
        userId,
        checkedInAt: iso(new Date(new Date(classRow.startsAt).getTime() + 10 * 60_000)),
        checkedOutAt: iso(new Date(new Date(classRow.endsAt).getTime() - 5 * 60_000)),
        method: index % 2 === 0 ? 'pin' : 'qr',
        status: 'checked_out',
        kioskId: 'seed-kiosk',
        hlc: `${classRow.startsAt}-0000-seed-${studentIndex}`,
        originDeviceId: 'seed-kiosk',
        syncStatus: 'synced',
        mutationId: uuidv7(),
        syncedAt: classRow.endsAt,
      })
      .run();
  }
});

const products = [
  { sku: 'GI-A2', name: 'Academy Gi (A2)', category: 'gi' as const, price: 42000, stock: 8 },
  { sku: 'RASH-M', name: 'Rashguard (M)', category: 'rashguard' as const, price: 12000, stock: 14 },
  { sku: 'TAPE-01', name: 'Finger tape', category: 'tape' as const, price: 1200, stock: 40 },
  { sku: 'WATER-500', name: 'Water bottle 500ml', category: 'drink' as const, price: 500, stock: 60 },
  { sku: 'MOUTH-01', name: 'Mouthguard', category: 'gear' as const, price: 4500, stock: 3 },
];
const productIds: string[] = [];
for (const product of products) {
  const productId = uuidv7();
  productIds.push(productId);
  db.insert(retailProducts)
    .values({
      id: productId,
      academyId,
      sku: product.sku,
      name: product.name,
      category: product.category,
      priceCents: product.price,
      costCents: Math.round(product.price * 0.55),
      currency: 'MYR',
      stockQuantity: product.stock,
      lowStockThreshold: 5,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Analytics enrichment. Everything above is operational data; the records
// below make the analytics suite demonstrate real funnels, churn and revenue
// mix rather than empty charts.
// ---------------------------------------------------------------------------

const acquisitionSources = [
  'walk_in',
  'social_media',
  'ads',
  'member_referral',
  'website',
  'other',
] as const;
studentIds.forEach((userId, index) => {
  db.update(users)
    .set({
      acquisitionSource: acquisitionSources[index % acquisitionSources.length]!,
      referredByUserId: index === 3 ? guardianId : null,
    })
    .where(eq(users.id, userId))
    .run();
});

const leadSeeds: Array<{
  name: [string, string];
  source: (typeof acquisitionSources)[number];
  status: 'new' | 'contacted' | 'trial_scheduled' | 'trial_attended' | 'converted' | 'lost';
  daysAgo: number;
  contactDaysAgo?: number;
  convertedStudent?: number;
}> = [
  { name: ['Nora', 'Iskandar'], source: 'social_media', status: 'converted', daysAgo: 120, contactDaysAgo: 8, convertedStudent: 0 },
  { name: ['Farah', 'Yusof'], source: 'member_referral', status: 'converted', daysAgo: 112, contactDaysAgo: 14, convertedStudent: 1 },
  { name: ['Wei Jie', 'Tan'], source: 'walk_in', status: 'converted', daysAgo: 96, contactDaysAgo: 20, convertedStudent: 2 },
  { name: ['Amira', 'Hassan'], source: 'ads', status: 'converted', daysAgo: 88, contactDaysAgo: 9, convertedStudent: 3 },
  { name: ['Jonas', 'Berg'], source: 'website', status: 'trial_attended', daysAgo: 12, contactDaysAgo: 4 },
  { name: ['Siti', 'Rahim'], source: 'social_media', status: 'trial_attended', daysAgo: 9, contactDaysAgo: 2 },
  { name: ['Arif', 'Dzul'], source: 'walk_in', status: 'trial_attended', daysAgo: 5, contactDaysAgo: 1 },
  { name: ['Maya', 'Lim'], source: 'member_referral', status: 'trial_scheduled', daysAgo: 6, contactDaysAgo: 1 },
  { name: ['Theo', 'Tan'], source: 'ads', status: 'trial_scheduled', daysAgo: 3, contactDaysAgo: 1 },
  { name: ['Ivy', 'Chong'], source: 'website', status: 'contacted', daysAgo: 18, contactDaysAgo: 15 },
  { name: ['Ravi', 'Menon'], source: 'walk_in', status: 'contacted', daysAgo: 11, contactDaysAgo: 10 },
  { name: ['Zara', 'Khan'], source: 'social_media', status: 'contacted', daysAgo: 4, contactDaysAgo: 3 },
  { name: ['Ben', 'Lee'], source: 'ads', status: 'new', daysAgo: 2 },
  { name: ['Cindy', 'Ooi'], source: 'other', status: 'lost', daysAgo: 60, contactDaysAgo: 55 },
];

for (const seed of leadSeeds) {
  const created = daysFromNow(-seed.daysAgo);
  const converted = seed.convertedStudent === undefined ? null : studentIds[seed.convertedStudent]!;
  const membership = converted
    ? db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, converted)).get()
    : null;
  db.insert(leads)
    .values({
      id: uuidv7(),
      academyId,
      firstName: seed.name[0],
      lastName: seed.name[1],
      email: `${seed.name[0].toLowerCase()}.${seed.name[1].toLowerCase().replace(/\s/g, '')}@lead.test`,
      phone: `+60129${String(1000 + seed.daysAgo)}`,
      source: seed.source,
      referredByUserId: seed.source === 'member_referral' ? studentIds[5]! : null,
      status: seed.status,
      trialAttendedAt:
        seed.status === 'trial_attended' || seed.status === 'converted'
          ? iso(daysFromNow(-Math.max(1, seed.daysAgo - 7)))
          : null,
      convertedAt: seed.status === 'converted' ? iso(daysFromNow(-Math.max(2, seed.daysAgo - 10))) : null,
      convertedMembershipId: membership?.id ?? null,
      lastContactAt: seed.contactDaysAgo ? iso(daysFromNow(-seed.contactDaysAgo)) : iso(created),
      notes: seed.status === 'lost' ? 'Joined another academy nearby' : null,
      createdAt: iso(created),
    })
    .run();
}

const incidentSeeds = [
  {
    user: studentIds[1]!,
    daysAgo: 21,
    type: 'injury' as const,
    severity: 'moderate' as const,
    description: 'Sprained wrist while bridging during live sparring.',
    action: 'Ice applied, removed from sparring, advised to see a doctor.',
    witness: 'Coach Marco Silva',
    status: 'closed' as const,
    followUp: true,
    completed: true,
  },
  {
    user: studentIds[4]!,
    daysAgo: 6,
    type: 'injury' as const,
    severity: 'minor' as const,
    description: 'Minor mat burn on knee during takedown drills.',
    action: 'Wound cleaned and covered; member cleared to continue.',
    witness: 'Nadia Tan',
    status: 'follow_up' as const,
    followUp: true,
    completed: false,
  },
  {
    user: null,
    daysAgo: 2,
    type: 'equipment' as const,
    severity: 'minor' as const,
    description: 'Loose mat edge near the north wall.',
    action: 'Mat taped down and inspected before the next session.',
    witness: 'Aisha Rahman',
    status: 'closed' as const,
    followUp: false,
    completed: false,
  },
];
for (const seed of incidentSeeds) {
  db.insert(incidents)
    .values({
      id: uuidv7(),
      academyId,
      userId: seed.user,
      programId: giProgramId,
      classId: demoClassId,
      occurredAt: iso(daysFromNow(-seed.daysAgo, 19)),
      location: 'Main mat',
      type: seed.type,
      severity: seed.severity,
      description: seed.description,
      actionTaken: seed.action,
      witnessName: seed.witness,
      reportedByUserId: coachId,
      followUpRequired: seed.followUp,
      followUpCompletedAt: seed.completed ? iso(daysFromNow(-seed.daysAgo + 1)) : null,
      status: seed.status,
      createdAt: iso(daysFromNow(-seed.daysAgo)),
    })
    .run();
}

// Retail sales: sale velocity for the pro-shop stock report.
const retailSales: Array<[number, number, number]> = [
  [0, 2, 4],
  [0, 1, 25],
  [1, 3, 11],
  [1, 2, 38],
  [2, 8, 7],
  [3, 6, 19],
  [4, 2, 2],
  [4, 1, 44],
];
retailSales.forEach(([productIndex, quantity, daysAgo], index) => {
  const productId = productIds[productIndex]!;
  const product = products[productIndex]!;
  const subtotal = product.price * quantity;
  const tax = Math.round(subtotal * 0.06);
  const transactionId = uuidv7();
  db.insert(transactions)
    .values({
      id: transactionId,
      academyId,
      type: 'retail',
      status: 'succeeded',
      userId: studentIds[index % studentIds.length]!,
      payerId: studentIds[index % studentIds.length]!,
      subtotalCents: subtotal,
      discountCents: 0,
      taxCents: tax,
      totalCents: subtotal + tax,
      currency: 'MYR',
      provider: 'manual',
      idempotencyKey: `seed-retail-${index}`,
      processedAt: iso(daysFromNow(-daysAgo)),
      createdAt: iso(daysFromNow(-daysAgo)),
    })
    .run();
  db.insert(transactionItems)
    .values({
      id: uuidv7(),
      transactionId,
      productId,
      description: product.name,
      quantity,
      unitPriceCents: product.price,
      totalCents: subtotal,
    })
    .run();
});

// Additional revenue streams reported in the monthly revenue & tax summary.
([
  ['private_session', 18000, 5],
  ['seminar', 45000, 33],
  ['private_session', 18000, 61],
] as const).forEach(([type, amount, daysAgo], index) => {
  const tax = Math.round(amount * 0.06);
  db.insert(transactions)
    .values({
      id: uuidv7(),
      academyId,
      type,
      status: 'succeeded',
      userId: studentIds[index % studentIds.length]!,
      payerId: studentIds[index % studentIds.length]!,
      subtotalCents: amount,
      discountCents: 0,
      taxCents: tax,
      totalCents: amount + tax,
      currency: 'MYR',
      provider: 'manual',
      idempotencyKey: `seed-${type}-${index}`,
      processedAt: iso(daysFromNow(-daysAgo)),
      createdAt: iso(daysFromNow(-daysAgo)),
    })
    .run();
});

// Failed-payment / aging receivables demonstration.
const pastDueMembership = db
  .select({ id: memberships.id })
  .from(memberships)
  .where(and(eq(memberships.academyId, academyId), eq(memberships.status, 'past_due')))
  .get();
if (pastDueMembership) {
  [1, 3, 7].forEach((daysAgo, attempt) => {
    db.insert(paymentRetries)
      .values({
        id: uuidv7(),
        academyId,
        membershipId: pastDueMembership.id,
        attemptNumber: attempt + 1,
        scheduledAt: iso(daysFromNow(-daysAgo)),
        attemptedAt: iso(daysFromNow(-daysAgo)),
        status: attempt === 2 ? 'scheduled' : 'attempted',
        provider: 'manual',
        failureCode: 'card_declined',
        failureMessage: 'Insufficient funds',
        createdAt: iso(daysFromNow(-daysAgo)),
      })
      .run();
  });
}

// Churn history: three former members with distinct cancellation reasons.
const churnedSeeds = [
  ['Farhan', 'Ali', 'relocated', -150, -140, -120],
  ['Yuki', 'Sato', 'time_constraints', -210, -90, -70],
  ['Omar', 'Bakar', 'too_expensive', -260, -55, -30],
] as const;
for (const [firstName, lastName, reason, joinedDays, cancelledDays, lastSeenDays] of churnedSeeds) {
  const userId = uuidv7();
  db.insert(users)
    .values({
      id: userId,
      academyId,
      role: 'student',
      status: 'inactive',
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@former.test`,
      pinHash: hashPin(academyId, uuidv7().slice(0, 4)),
      qrToken: `gym_${uuidv7().replace(/-/g, '')}`,
      createdAt: iso(daysFromNow(joinedDays)),
      acquisitionSource: reason === 'relocated' ? 'ads' : 'walk_in',
    })
    .run();
  db.insert(waivers)
    .values({
      id: uuidv7(),
      academyId,
      userId,
      programId: giProgramId,
      waiverType: 'general',
      documentVersion: 1,
      documentTitle: 'Participation and liability waiver',
      documentHash: sha256(waiverBody),
      signatureData: waiverSignature,
      signatureFormat: 'svg_path',
      signerName: `${firstName} ${lastName}`,
      signerIp: '127.0.0.1',
      userAgent: 'seed-script',
      signedAt: iso(daysFromNow(joinedDays)),
      status: 'signed',
      expiresAt: iso(daysFromNow(joinedDays + 365)),
      hlc: `${iso(daysFromNow(joinedDays))}-0000-seed-churn`,
      mutationId: uuidv7(),
      syncStatus: 'synced',
    })
    .run();
  db.insert(memberships)
    .values({
      id: uuidv7(),
      academyId,
      userId,
      planId: planIds[0]!,
      status: 'cancelled',
      currentPeriodStart: iso(daysFromNow(cancelledDays - 30)),
      currentPeriodEnd: iso(daysFromNow(cancelledDays)),
      provider: 'manual',
      cancelledAt: iso(daysFromNow(cancelledDays)),
      cancellationReason: reason,
      cancellationNote: 'Recorded during seed for churn analytics',
      createdAt: iso(daysFromNow(joinedDays)),
    })
    .run();
  const oldClass = classRows.find((row) => daysFromNow(lastSeenDays) > new Date(row.startsAt));
  if (oldClass) {
    db.insert(attendanceLogs)
      .values({
        id: uuidv7(),
        academyId,
        classId: oldClass.id,
        userId,
        checkedInAt: iso(daysFromNow(lastSeenDays)),
        method: 'pin',
        status: 'checked_out',
        kioskId: 'seed-kiosk',
        hlc: `${iso(daysFromNow(lastSeenDays))}-0000-seed-churn`,
        originDeviceId: 'seed-kiosk',
        syncStatus: 'synced',
        mutationId: uuidv7(),
      })
      .run();
  }
}

// ---------------------------------------------------------------- SaaS layer
const planSeed = [
  {
    slug: 'starter' as const,
    name: 'Starter',
    description: 'One location, the essentials.',
    priceCents: 0,
    sortOrder: 0,
    features: ['members', 'schedule', 'attendance', 'billing', 'waivers'],
  },
  {
    slug: 'growth' as const,
    name: 'Growth',
    description: 'Automate marketing, import data and embed widgets.',
    priceCents: 49_900,
    sortOrder: 1,
    features: [
      'members', 'schedule', 'attendance', 'billing', 'waivers',
      'automated_marketing', 'csv_import', 'widgets', 'curriculum_video',
      'cross_training', 'advanced_analytics',
    ],
  },
  {
    slug: 'network' as const,
    name: 'Network',
    description: 'Multi-location rollups and franchise management.',
    priceCents: 149_900,
    sortOrder: 2,
    features: [
      'members', 'schedule', 'attendance', 'billing', 'waivers',
      'automated_marketing', 'csv_import', 'widgets', 'curriculum_video',
      'cross_training', 'advanced_analytics', 'multi_site',
    ],
  },
];
const planIdBySlug: Record<string, string> = {};
for (const plan of planSeed) {
  const id = uuidv7();
  db.insert(saasPlans)
    .values({ id, ...plan, currency: 'MYR', isPublic: true })
    .onConflictDoNothing({ target: saasPlans.slug })
    .run();
  // An upsert that hit an existing slug keeps that row's original id.
  planIdBySlug[plan.slug] = db
    .select({ id: saasPlans.id })
    .from(saasPlans)
    .where(eq(saasPlans.slug, plan.slug))
    .get()!.id;
}

db.insert(academySubscriptions)
  .values({
    id: uuidv7(),
    academyId,
    planId: planIdBySlug['network']!,
    status: 'active',
    trialEndsAt: iso(daysFromNow(-14)),
    currentPeriodEnd: iso(daysFromNow(30)),
    provider: 'manual',
  })
  .run();

db.insert(onboardingProgress)
  .values({
    id: uuidv7(),
    academyId,
    currentStep: 'team',
    completedSteps: ['profile', 'locations', 'programs', 'members', 'billing'],
  })
  .run();

// A branch location proves that network rollups work without leaking rosters.
const branchId = uuidv7();
db.insert(academies)
  .values({
    id: branchId,
    parentAcademyId: academyId,
    name: 'Iron Temple — Petaling Jaya',
    slug: `${ACADEMY_SLUG}-pj`,
    timezone: 'Asia/Kuala_Lumpur',
    currency: 'MYR',
    countryCode: 'MY',
    city: 'Petaling Jaya',
    state: 'Selangor',
    settings: {
      beltSystemId: 'ibjjf_adult',
      checkInPinLength: 4,
      gracePeriodDays: 7,
      waiverVersion: 1,
      autoCheckoutHours: 3,
      promoMinMonths: {},
      currencyDecimals: 2,
    },
  })
  .run();
db.insert(academySubscriptions)
  .values({
    id: uuidv7(),
    academyId: branchId,
    planId: planIdBySlug['growth']!,
    status: 'active',
    currentPeriodEnd: iso(daysFromNow(30)),
    provider: 'manual',
  })
  .run();
db.insert(users)
  .values({
    id: uuidv7(),
    academyId: branchId,
    role: 'admin',
    status: 'active',
    firstName: 'Hana',
    lastName: 'Yusof',
    email: 'branch-admin@gymlytics.test',
    phone: '+60123456999',
    passwordHash: hashPassword(PASSWORD),
    pinHash: hashPin(branchId, '1300'),
  })
  .run();

for (const [index, video] of ([
  ['Closed guard break — hip bump', 'Fundamental escape with framing hip elevation.', 480],
  ['Mount escape — bridge and roll', 'Timing drill for the classic upa escape.', 360],
  ['Collar sleeve choke — entry angles', 'Angle creation before the grip commit.', 620],
] as Array<readonly [string, string, number]>).entries()) {
  db.insert(curriculumVideos)
    .values({
      id: uuidv7(),
      academyId,
      programId: giProgramId,
      beltSlug: 'blue',
      title: video[0]!,
      description: video[1]!,
      url: `https://www.youtube.com/watch?v=demo${index + 1}`,
      durationSeconds: video[2]!,
      sortOrder: index,
      createdByUserId: coachId,
    })
    .run();
}

const firstClass = classRows[0];
if (firstClass) {
  db.insert(classRecaps)
    .values({
      id: uuidv7(),
      academyId,
      classId: firstClass.id,
      coachId,
      summary: 'Worked the hip-bump escape from closed guard, then three rounds of positional sparring from mount.',
      techniques: ['Hip bump escape', 'Bridge and roll', 'Mount retention'],
    })
    .run();
}

const widgetSeed = [
  ['schedule', 'Public class schedule', { limit: 8, title: 'Train with us' }],
  ['trial_form', 'Book a trial class', { title: 'Book your trial', redirectUrl: '/waiver' }],
  ['waiver_link', 'Sign the visitor waiver', { title: 'Digital waiver' }],
] as const;
for (const [kind, label, config] of widgetSeed) {
  db.insert(widgets)
    .values({
      id: uuidv7(),
      academyId,
      kind,
      label,
      token: `w_${createHash('sha256').update(`${academyId}:${kind}`).digest('hex').slice(0, 24)}`,
      config: { ...config },
    })
    .run();
}

const affiliationId = uuidv7();
db.insert(affiliations)
  .values({
    id: affiliationId,
    academyId,
    name: 'Riptide Jiu-Jitsu',
    contactEmail: 'hello@riptide.test',
    verificationCode: 'RIPTIDE-2026',
    verifiedAt: iso(daysFromNow(-20)),
  })
  .run();

db.insert(crossTrainingPasses)
  .values({
    id: uuidv7(),
    academyId,
    userId: allStudents[0]!,
    affiliationId,
    qrToken: `pass_${createHash('sha256').update(`${academyId}:visitor`).digest('hex').slice(0, 24)}`,
    passDate: iso(daysFromNow(0)).slice(0, 10),
    status: 'approved',
    notes: 'Verified visiting grappler from Riptide Jiu-Jitsu',
  })
  .run();

db.insert(importJobs)
  .values({
    id: uuidv7(),
    academyId,
    type: 'members',
    status: 'completed',
    fileName: 'march-members.csv',
    totalRows: 3,
    importedRows: 3,
    errors: [],
    createdByUserId: ownerId,
  })
  .run();

console.log(`
[seed] Iron Temple Academy is ready.

  Admin login   owner@gymlytics.test / ${PASSWORD}
  Coach login   coach@gymlytics.test / ${PASSWORD}
  Front desk    frontdesk@gymlytics.test / ${PASSWORD}
  Guardian      parent@gymlytics.test / ${PASSWORD}
  Member        daniel@student.test / ${PASSWORD}
  Kiosk PIN     1234 owner · 1235 coach · 1236 front desk · 1200+ students

  Academy slug  ${ACADEMY_SLUG}
  Programs      ${programSeeds.length}
  Members       ${allStudents.length + staffRows.length}
  Classes       ${classRows.length + 1}
`);
