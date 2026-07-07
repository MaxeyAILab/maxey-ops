/**
 * Development seed: one user per role + a realistic sample project so every
 * module has data to demo. Run with `npm run db:seed`.
 * All dev passwords are "maxey123" — change before any real deployment.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("maxey123", 10);

  const jacob = await prisma.user.upsert({
    where: { email: "jacob@maxeyconstruction.ph" },
    update: {},
    create: {
      name: "Jacob Villamor",
      email: "jacob@maxeyconstruction.ph",
      phone: "+639170000001",
      passwordHash: hash,
      role: "OWNER",
      position: "Owner / Civil Engineer",
      department: "OFFICE",
    },
  });

  const pm = await prisma.user.upsert({
    where: { email: "pm@maxeyconstruction.ph" },
    update: {},
    create: {
      name: "Elena Reyes",
      email: "pm@maxeyconstruction.ph",
      passwordHash: hash,
      role: "PM",
      position: "Project Manager",
      department: "OFFICE",
    },
  });

  const foreman = await prisma.user.upsert({
    where: { email: "foreman@maxeyconstruction.ph" },
    update: {},
    create: {
      name: "Ramon Cruz",
      email: "foreman@maxeyconstruction.ph",
      passwordHash: hash,
      role: "FOREMAN",
      position: "Foreman",
      department: "SITE",
      dailyRate: 800,
    },
  });

  await prisma.user.upsert({
    where: { email: "purchasing@maxeyconstruction.ph" },
    update: {},
    create: {
      name: "Marites Santos",
      email: "purchasing@maxeyconstruction.ph",
      passwordHash: hash,
      role: "PURCHASING",
      position: "Purchasing Officer",
      department: "OFFICE",
    },
  });

  const accounting = await prisma.user.upsert({
    where: { email: "accounting@maxeyconstruction.ph" },
    update: {},
    create: {
      name: "Divina Lopez",
      email: "accounting@maxeyconstruction.ph",
      passwordHash: hash,
      role: "ACCOUNTING",
      position: "Accountant",
      department: "OFFICE",
    },
  });

  // Sample client + portal login
  const client = await prisma.client.upsert({
    where: { id: "seed-client-1" },
    update: {},
    create: {
      id: "seed-client-1",
      name: "Dela Cruz Family",
      contactName: "Antonio Dela Cruz",
      email: "client@example.com",
      phone: "+639180000002",
      address: "Cabanatuan City, Nueva Ecija",
      source: "REFERRAL",
    },
  });

  await prisma.user.upsert({
    where: { email: "client@example.com" },
    update: {},
    create: {
      name: "Antonio Dela Cruz",
      email: "client@example.com",
      passwordHash: hash,
      role: "CLIENT",
      clientId: client.id,
    },
  });

  // Sample project with terms, payments, requisitions, CO, progress
  const existing = await prisma.project.findFirst({ where: { name: "Dela Cruz Residence" } });
  if (!existing) {
    const project = await prisma.project.create({
      data: {
        clientId: client.id,
        name: "Dela Cruz Residence",
        address: "Brgy. Sumacab, Cabanatuan City",
        contractValue: 4_500_000,
        status: "ONGOING_CONSTRUCTION",
        startDate: new Date(Date.now() - 60 * 86_400_000),
        targetEndDate: new Date(Date.now() + 120 * 86_400_000),
        paymentTerms: {
          create: [
            { type: "DOWNPAYMENT", label: "Downpayment (30%)", amount: 1_350_000, status: "PAID", sortOrder: 0 },
            { type: "PARTIAL", label: "Progress billing", amount: 2_700_000, status: "DUE", sortOrder: 1 },
            {
              type: "RETENTION",
              label: "Retention (10%)",
              amount: 450_000,
              dueCondition: "Released after acceptance / defects liability period",
              sortOrder: 2,
            },
          ],
        },
      },
      include: { paymentTerms: true },
    });

    const dpTerm = project.paymentTerms.find((t) => t.type === "DOWNPAYMENT")!;
    await prisma.payment.create({
      data: {
        projectId: project.id,
        paymentTermId: dpTerm.id,
        amount: 1_350_000,
        dateReceived: new Date(Date.now() - 55 * 86_400_000),
        method: "Bank transfer",
        recordedById: accounting.id,
      },
    });

    // Approved requisition with PO (committed cost)
    const req1 = await prisma.requisition.create({
      data: {
        clientUuid: randomUUID(),
        projectId: project.id,
        submittedById: foreman.id,
        submittedAt: new Date(Date.now() - 20 * 86_400_000),
        urgency: "HIGH",
        status: "PO_ISSUED",
        estimatedCost: 185_000,
        approvedById: jacob.id,
        approvedAt: new Date(Date.now() - 19 * 86_400_000),
        items: {
          create: [
            { name: "Portland cement", spec: "Type 1, 40kg", qty: 300, unit: "bags" },
            { name: "Deformed rebar", spec: "12mm x 6m, Grade 40", qty: 200, unit: "pcs" },
            { name: "Washed sand", qty: 12, unit: "cu.m" },
          ],
        },
      },
    });
    await prisma.purchaseOrder.create({
      data: {
        poNumber: "PO-2026-0001",
        requisitionId: req1.id,
        supplier: "NE Builders Supply",
        totalCost: 182_400,
        deliveryDate: new Date(Date.now() - 15 * 86_400_000),
        createdById: jacob.id,
        items: [
          { name: "Portland cement", qty: 300, unit: "bags", unitCost: 260 },
          { name: "Deformed rebar", qty: 200, unit: "pcs", unitCost: 435 },
          { name: "Washed sand", qty: 12, unit: "cu.m", unitCost: 1450 },
        ],
      },
    });

    // Pending requisition awaiting Jacob
    await prisma.requisition.create({
      data: {
        clientUuid: randomUUID(),
        projectId: project.id,
        submittedById: foreman.id,
        submittedAt: new Date(Date.now() - 1 * 86_400_000),
        urgency: "NORMAL",
        notes: "For second-floor slab works next week.",
        status: "SUBMITTED",
        items: {
          create: [
            { name: "Plywood (marine)", spec: "1/2 inch, 4x8", qty: 40, unit: "shts" },
            { name: "Common wire nails", spec: '2"', qty: 25, unit: "kgs" },
          ],
        },
      },
    });

    // Change order pending client approval
    await prisma.changeOrder.create({
      data: {
        projectId: project.id,
        title: "Upgrade to granite kitchen countertop",
        description:
          "Client-requested upgrade from laminated to granite countertop, including reinforced base cabinet.",
        costImpact: 145_000,
        timeImpactDays: 7,
        createdById: pm.id,
      },
    });

    // Progress timeline
    const progress: [number, number, string, string][] = [
      [45, 5, "Mobilization & site clearing", "Site cleared, temporary facilities set up."],
      [30, 32, "Foundation works", "Excavation and footings poured, cured per schedule."],
      [10, 38, "Ground floor structure", "Columns and beams completed; slab poured."],
      [2, 42, "Second floor works", "Second-floor column rebar ongoing."],
    ];
    for (const [daysAgo, pct, workItem, notes] of progress) {
      await prisma.progressEntry.create({
        data: {
          clientUuid: randomUUID(),
          projectId: project.id,
          submittedById: pm.id,
          workItem,
          pctComplete: pct,
          notes,
          createdAt: new Date(Date.now() - daysAgo * 86_400_000),
        },
      });
    }
  }

  // Second sample project: ₱30M tourism building in Calauan, Laguna
  const existingTourism = await prisma.project.findFirst({
    where: { name: "Calauan Tourism & Cultural Center" },
  });
  if (!existingTourism) {
    const lguClient = await prisma.client.upsert({
      where: { id: "seed-client-2" },
      update: {},
      create: {
        id: "seed-client-2",
        name: "Municipality of Calauan",
        contactName: "Engr. Roberto Magsino",
        email: "engineering@calauan.gov.ph",
        phone: "+639210000005",
        address: "Calauan, Laguna",
        source: "GOVERNMENT_BID",
      },
    });

    const tourism = await prisma.project.create({
      data: {
        clientId: lguClient.id,
        name: "Calauan Tourism & Cultural Center",
        address: "Brgy. Dayap, Calauan, Laguna",
        contractValue: 30_000_000,
        status: "ONGOING_CONSTRUCTION",
        pcabRef: "PCAB-BID-2026-0117",
        startDate: new Date(Date.now() - 40 * 86_400_000),
        targetEndDate: new Date(Date.now() + 420 * 86_400_000),
        paymentTerms: {
          create: [
            { type: "DOWNPAYMENT", label: "Downpayment (15%)", amount: 4_500_000, status: "PAID", sortOrder: 0 },
            { type: "PARTIAL", label: "Progress billing", amount: 22_500_000, status: "DUE", sortOrder: 1 },
            {
              type: "RETENTION",
              label: "Retention (10%)",
              amount: 3_000_000,
              dueCondition: "Released after final acceptance / defects liability period",
              sortOrder: 2,
            },
          ],
        },
      },
      include: { paymentTerms: true },
    });

    const tourismDp = tourism.paymentTerms.find((t) => t.type === "DOWNPAYMENT")!;
    await prisma.payment.create({
      data: {
        projectId: tourism.id,
        paymentTermId: tourismDp.id,
        amount: 4_500_000,
        dateReceived: new Date(Date.now() - 35 * 86_400_000),
        method: "Bank transfer",
        reference: "LBP-2026-88231",
        recordedById: accounting.id,
      },
    });

    // Committed cost: approved requisition with PO for site works package
    const tourismReq = await prisma.requisition.create({
      data: {
        clientUuid: randomUUID(),
        projectId: tourism.id,
        submittedById: foreman.id,
        submittedAt: new Date(Date.now() - 30 * 86_400_000),
        urgency: "HIGH",
        notes: "Initial earthworks and foundation package.",
        status: "PO_ISSUED",
        estimatedCost: 2_450_000,
        approvedById: jacob.id,
        approvedAt: new Date(Date.now() - 29 * 86_400_000),
        items: {
          create: [
            { name: "Portland cement", spec: "Type 1, 40kg", qty: 2000, unit: "bags" },
            { name: "Deformed rebar", spec: "16mm x 6m, Grade 60", qty: 1500, unit: "pcs" },
            { name: "Gravel (3/4)", qty: 120, unit: "cu.m" },
            { name: "Washed sand", qty: 90, unit: "cu.m" },
          ],
        },
      },
    });
    await prisma.purchaseOrder.create({
      data: {
        poNumber: "PO-2026-0002",
        requisitionId: tourismReq.id,
        supplier: "Laguna Prime Builders Depot",
        totalCost: 2_386_500,
        deliveryDate: new Date(Date.now() - 22 * 86_400_000),
        createdById: jacob.id,
        items: [
          { name: "Portland cement", qty: 2000, unit: "bags", unitCost: 255 },
          { name: "Deformed rebar", qty: 1500, unit: "pcs", unitCost: 980 },
          { name: "Gravel (3/4)", qty: 120, unit: "cu.m", unitCost: 1550 },
          { name: "Washed sand", qty: 90, unit: "cu.m", unitCost: 1420 },
        ],
      },
    });

    const tourismProgress: [number, number, string, string][] = [
      [38, 3, "Mobilization & site development", "Site office and batching area established."],
      [24, 8, "Earthworks", "Cut-and-fill completed; compaction tests passed."],
      [12, 12, "Foundation works", "Footing excavation and rebar laying ongoing."],
      [3, 15, "Foundation works", "60% of footings poured."],
    ];
    for (const [daysAgo, pct, workItem, notes] of tourismProgress) {
      await prisma.progressEntry.create({
        data: {
          clientUuid: randomUUID(),
          projectId: tourism.id,
          submittedById: pm.id,
          workItem,
          pctComplete: pct,
          notes,
          createdAt: new Date(Date.now() - daysAgo * 86_400_000),
        },
      });
    }
  }

  // Sample open leads
  if ((await prisma.lead.count()) === 0) {
    await prisma.lead.createMany({
      data: [
        {
          contactName: "Maria Gonzales",
          email: "maria.g@example.com",
          phone: "+639190000003",
          address: "San Isidro, Nueva Ecija",
          source: "WEBSITE",
          message: "Looking to build a 2-storey commercial building, around 180 sqm floor area.",
          status: "NEW",
          estimateDueBy: new Date(Date.now() + 4 * 86_400_000),
          createdAt: new Date(Date.now() - 1 * 86_400_000),
        },
        {
          contactName: "Brgy. Capt. Mendoza",
          phone: "+639200000004",
          address: "Gapan City",
          source: "FACEBOOK",
          message: "Requesting quotation for barangay road concreting, approx 350 linear meters.",
          status: "UNDER_REVIEW",
          estimateDueBy: new Date(Date.now() + 2 * 86_400_000),
          createdAt: new Date(Date.now() - 3 * 86_400_000),
        },
      ],
    });
  }

  // ---------- Phase 2 demo data ----------

  // More workers with rate profiles per department (Spec 6.5)
  const siteWorkers = [
    { email: "mason1@maxeyconstruction.ph", name: "Pedro Alvarez", dailyRate: 700, position: "Mason" },
    { email: "mason2@maxeyconstruction.ph", name: "Jun Bautista", dailyRate: 650, position: "Carpenter" },
  ];
  for (const w of siteWorkers) {
    await prisma.user.upsert({
      where: { email: w.email },
      update: {},
      create: {
        name: w.name,
        email: w.email,
        passwordHash: hash,
        role: "OFFICE", // limited-module staff role; department drives payroll
        department: "SITE",
        position: w.position,
        dailyRate: w.dailyRate,
      },
    });
  }
  const officeStaff = await prisma.user.upsert({
    where: { email: "office@maxeyconstruction.ph" },
    update: {},
    create: {
      name: "Liza Manalo",
      email: "office@maxeyconstruction.ph",
      passwordHash: hash,
      role: "OFFICE",
      department: "OFFICE",
      position: "Office Admin",
      dailyRate: 750,
    },
  });
  const driver = await prisma.user.upsert({
    where: { email: "driver@maxeyconstruction.ph" },
    update: {},
    create: {
      name: "Boyet Ramos",
      email: "driver@maxeyconstruction.ph",
      passwordHash: hash,
      role: "DRIVER",
      department: "DRIVER",
      position: "Driver",
      dailyRate: 700,
    },
  });

  // A week of completed attendance so payroll runs have data
  if ((await prisma.attendance.count()) === 0) {
    const delaCruz = await prisma.project.findFirst({ where: { name: "Dela Cruz Residence" } });
    const clockUsers = [
      ...(await prisma.user.findMany({ where: { department: "SITE" } })),
      officeStaff,
      driver,
    ];
    for (const u of clockUsers) {
      for (let daysAgo = 6; daysAgo >= 1; daysAgo--) {
        const day = new Date(Date.now() - daysAgo * 86_400_000);
        day.setHours(7, 0, 0, 0); // 7:00 AM in
        const hoursWorked = daysAgo % 3 === 0 ? 10 : 8; // some OT days
        const out = new Date(day.getTime() + hoursWorked * 3_600_000);
        await prisma.attendance.create({
          data: {
            clientUuid: randomUUID(),
            userId: u.id,
            projectId: u.department === "SITE" ? delaCruz?.id : null,
            timeIn: day,
            timeOut: out,
            source: "online",
          },
        });
      }
    }
  }

  // Warehouse stock + a sample movement (Spec 6.4)
  if ((await prisma.warehouseItem.count()) === 0) {
    const plywood = await prisma.warehouseItem.create({
      data: { name: "Plywood (marine) 1/2\"", unit: "shts", currentQty: 25 },
    });
    await prisma.warehouseItem.createMany({
      data: [
        { name: "Portland cement Type 1", unit: "bags", currentQty: 80 },
        { name: "Scaffolding frame set", unit: "sets", currentQty: 14 },
        { name: "GI tie wire", unit: "kgs", currentQty: 40 },
      ],
    });
    await prisma.inventoryMovement.create({
      data: {
        clientUuid: randomUUID(),
        itemId: plywood.id,
        type: "SITE_TO_WAREHOUSE",
        qty: 25,
        fromLoc: "Dela Cruz site",
        toLoc: "Main warehouse",
        actorId: foreman.id,
        createdAt: new Date(Date.now() - 5 * 86_400_000),
      },
    });
  }

  // Project payroll roster (per-project payroll)
  if ((await prisma.projectAssignment.count()) === 0) {
    const delaCruz = await prisma.project.findFirst({ where: { name: "Dela Cruz Residence" } });
    if (delaCruz) {
      const crew = await prisma.user.findMany({ where: { department: "SITE" } });
      for (const w of crew) {
        await prisma.projectAssignment.create({
          data: {
            projectId: delaCruz.id,
            userId: w.id,
            startDate: new Date(Date.now() - 60 * 86_400_000),
            hourlyRate: w.dailyRate ? Number(w.dailyRate) / 8 : 85,
          },
        });
      }
    }
  }

  // Sample site instructions (Spec 6.6)
  if ((await prisma.siteInstruction.count()) === 0) {
    const delaCruz = await prisma.project.findFirst({ where: { name: "Dela Cruz Residence" } });
    if (delaCruz) {
      await prisma.siteInstruction.create({
        data: {
          projectId: delaCruz.id,
          postedById: jacob.id,
          text: "Verify second-floor column alignment against grid line B before pouring. Use revised structural drawing S-04 Rev 2.",
          status: "ACKNOWLEDGED",
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        },
      });
      await prisma.siteInstruction.create({
        data: {
          projectId: delaCruz.id,
          postedById: pm.id,
          text: "Cover all exposed rebar before the weekend — rain expected. Photograph after covering.",
          status: "OPEN",
        },
      });
    }
  }

  console.log("Seed complete.");
  console.log("Logins (password: maxey123):");
  console.log("  Owner:      jacob@maxeyconstruction.ph");
  console.log("  PM:         pm@maxeyconstruction.ph");
  console.log("  Foreman:    foreman@maxeyconstruction.ph");
  console.log("  Purchasing: purchasing@maxeyconstruction.ph");
  console.log("  Accounting: accounting@maxeyconstruction.ph");
  console.log("  Client:     client@example.com");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
