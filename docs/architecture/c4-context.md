# C4 Level 1 — System Context

```mermaid
C4Context
    title System Context diagram for Gymlytics
    updateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")

    Person(student, "Student / Parent", "Books classes, tracks belt progress, signs waivers")
    Person(guardian, "Guardian / Payer", "Pays for dependents, signs guardian waivers")
    Person(coach, "Coach / Front-desk staff", "Runs check-in, teaches curriculum, approves promotions")
    Person(owner, "Academy owner", "Manages memberships, POS retail and billing")

    System(gymlytics, "Gymlytics", "Offline-first academy management for BJJ & martial arts")

    System_Ext(stripe, "Stripe", "Global cards, subscriptions, webhooks")
    System_Ext(billplz, "Billplz", "Malaysian FPX / online-banking one-off payments")
    System_Ext(ipay88, "iPay88", "SEA local cards, FPX and recurring where enabled")
    System_Ext(twilio, "Twilio / SendGrid", "SMS + email for reminders and dunning")
    System_Ext(pdf, "PDF renderer", "Generates signed waiver PDFs on demand")

    Rel(student, gymlytics, "Books classes, views stripes and mat hours")
    Rel(guardian, gymlytics, "Pays for dependents, signs guardian waivers")
    Rel(coach, gymlytics, "Checks in students, logs techniques taught")
    Rel(owner, gymlytics, "Configures programs, plans and retail stock")
    Rel(gymlytics, stripe, "Creates subscriptions, receives webhooks")
    Rel(gymlytics, billplz, "Creates FPX bills, receives callbacks")
    Rel(gymlytics, ipay88, "Hosted checkout, recurring charges, callbacks")
    Rel(gymlytics, twilio, "Sends missed-class, belt-eligibility and payment alerts")
    Rel(gymlytics, pdf, "Renders versioned waiver + signature to PDF")
```

> Note: the guardian is modelled as a `users` row linked via `family_links`, not a separate
> table. It is drawn separately here because a guardian rarely trains but always interacts
> with billing and waivers.

## What this boundary tells us

- The **kiosk is not an external system** — it is a deployment mode of the same Vue web app.
  Keeping it inside the boundary is deliberate: one codebase, one set of Zod contracts.
- Payment providers are genuinely external: they own money movement and webhook truth.
  Our ledger tables are the anti-corruption layer between their events and our domain.
- Notifications are outbound-only; no provider can write back into Gymlytics except via
  the payment webhook routes.
