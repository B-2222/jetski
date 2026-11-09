# Jet Ski (Sea-Doo) Research for a Realistic Driving Game

This is the research base for building a realistic Sea-Doo driving game. It covers how the machine works, how it turns, how rider weight changes its behaviour, and the real numbers we can use to tune the physics.

**How to read this file:** Each fact is tagged with how much we can trust it.

- **[Sourced]** comes from a manufacturer page, spec sheet, owner's manual, or magazine test.
- **[Reviewer/Forum]** comes from rider reviews, dealer blogs, or forums. It is useful, but it is one person's experience.
- **[Engineering estimate]** is my own physics reasoning or estimate where no source gave a number. These are starting values for tuning, not facts.

---

## 1. How a jet ski actually moves

### 1.1 The jet pump (there is no propeller)

- Water comes in through an **intake grate** under the hull. The pump speeds it up and shoots it out the back through the **steering nozzle**. [Sourced]
- The moving part is the **impeller**, a spinning bladed rotor driven straight off the engine crankshaft by a driveshaft. It sits inside a tight-fitting **wear ring**. The gap is small (one source says under about 0.005 in). If the gap grows, the pump loses pressure, top speed and acceleration drop, and the pump **cavitates**. [Sourced/Reviewer]
- Modern Sea-Doo 1630 ACE models (RXP-X, RXT-X, GTX 300/325) use a **161 mm pump** with a **4-blade stainless impeller**. Typical pitch is about **13 degrees at the leading edge rising to 16 to 18 degrees at the trailing edge**. Older 1503 supercharged models used a 159 mm pump. [Reviewer: parts retailers]
- After the impeller there are fixed **stator vanes** that straighten the swirling water before the nozzle. [Engineering knowledge]

**Thrust physics** [Sourced: MIT marine propulsion notes]

```
Thrust = mass_flow * (V_jet - V_boat)
mass_flow = water_density * nozzle_area * V_jet
Ideal jet efficiency = 2 / (1 + V_jet / V_boat)
```

What this means for the game:
- At **standstill** the jet is pushing against still water, so thrust is at its **maximum**. This is why a jet ski launches so hard.
- As speed rises, `V_jet - V_boat` shrinks, so **thrust falls off with speed**. Top speed is where thrust equals drag.
- The pump is a load on the engine. By pump "affinity laws", **pump torque rises with RPM squared** and **pump power rises with RPM cubed**. So the engine finds a natural RPM for each throttle position. [Engineering knowledge]

### 1.2 Steering comes from the jet, not a rudder

- The handlebars are connected by cable to the nozzle. Turning the bars swings the nozzle left or right and **points the jet sideways**, which pushes the back of the craft the other way. [Sourced]
- **No throttle = almost no steering.** If you let go of the throttle, the jet weakens and you lose most steering. This is the single most important thing new riders get wrong, and it causes many crashes (riders let go to avoid something and go straight into it). [Sourced: boating safety sites]
- **Off-throttle steering (OTS)**: Newer skis add a little steering when you let go. Sea-Doo's older version, **OPAS**, used two small side rudders linked to the nozzle that dropped down when pump pressure was low. Newer Sea-Doos use electronics (iTC/iBR) to give a bit of power when you turn with the throttle off. [Sourced/Reviewer]
- Steering strength scales with **jet strength**, so: more throttle = sharper turn. [Sourced]

**Game rule:** `yaw_torque = thrust * sin(nozzle_angle) * distance_from_nozzle_to_CG`. Nozzle travel is roughly plus or minus 20 to 25 degrees. [Engineering estimate]

### 1.3 Trim: VTS (Variable Trim System)

- VTS **tilts the nozzle up or down**, which points the thrust slightly up or down. [Sourced: Sea-Doo manual]
- **Trim up (bow up):** less hull in the water, less drag, **higher top speed**, but looser steering. Good on glassy flat water. On the Spark it also lifts the bow easily for tricks. [Sourced/Reviewer]
- **Trim down (bow down):** more hull in the water, **better grip and sharper steering**, better in chop. Too much can make the bow dig in. [Reviewer]
- Range on the Spark: about **+7 degrees up to -4.5 degrees down**. Extended-range kits roughly double this. [Reviewer: Spark review]
- Trim also **compensates for weight**, for example a passenger or gear on the back. [Sourced]
- Sea-Doo performance models also have a **launch mode** that auto-trims the nose down for the start, then trims up. [Reviewer]

### 1.4 Brake and reverse: iBR (Intelligent Brake and Reverse)

- A **reverse bucket** sits behind the nozzle. When it drops down, it **redirects the jet forward** under the hull, which pushes the ski backwards (brake or reverse). [Sourced: BRP]
- Squeeze the **left-hand lever**: the computer **cuts engine power for a moment**, drops the bucket, then **adds power back** to push harder backwards. [Sourced: BRP]
- **Braking strength follows how hard you pull the lever.** [Sourced]
- BRP claims it stops up to **48 m (about 160 ft) shorter** than a ski without a brake (older generation figure). [Sourced: BRP marketing]
- **Neutral:** the bucket sits half-down so forward and backward thrust cancel. That lets you start the engine at the dock without lurching forward. [Sourced]
- **In reverse, steering feels backwards** to riders, and it takes practice. Reverse is for idle speeds only. [Reviewer]
- Braking while turning tightens the turn (riders use it for sharp stops and tight corners). [Reviewer]

### 1.5 Throttle and riding modes: iTC (Intelligent Throttle Control)

The throttle is **drive-by-wire** (the trigger sends a signal to a computer, not a cable to the engine). [Sourced]

| Mode | What it does |
|---|---|
| **Touring** (default) | Softens acceleration from a stop and at low power. Smooth for cruising or two-up. |
| **Sport** | Full power, sharp response. Must be picked manually. |
| **ECO** | Limits RPM to the most efficient cruise speed. BRP claims up to 46% better fuel use. |
| **Slow speed / No-wake** | Caps speed very low for marinas. |
| **Cruise control** | Holds a set speed. |
| **Ski mode** | Controlled launch for towing a skier/wakeboarder. Adjustable launch strength. |
| **Launch control** | On RXP-X/RXT-X. Optimises trim and power for the hardest start. |

[Sourced/Reviewer; exact availability depends on model and year]

---

## 2. The engine: Rotax 1630 ACE

| Fact | Value | Trust |
|---|---|---|
| Type | 1630 cc, 3-cylinder, 4-stroke | Sourced |
| Power levels | 130, 170, 230, 300, 325 hp (325 is the newest top model) | Sourced |
| Supercharger | On 230, 300, 325. Spins about 47,000 rpm on the 300. The 325 uses a planetary gear to spin the supercharger impeller about 100,000 rpm | Sourced: Boating Mag |
| Intercooler | External intercooler on supercharged versions | Sourced |
| Cooling | **Closed-loop cooling** (coolant, like a car radiator) on newer models | Sourced |
| Rev limiter | About **8,000 rpm** (230/300), about **8,250 rpm** (325) | Reviewer |
| Idle | About 1,500 to 1,800 rpm | Engineering estimate |
| Fuel use at full throttle | About **20 to 25 US gal/h** (300 hp) | Reviewer |
| Fuel use cruising | About **4 to 5 US gal/h** (supercharged models, careful riding) | Reviewer |

The smaller **Rotax 900 ACE** (3-cylinder, 899 cc) powers the **Spark** at **60 hp** or **90 hp**. [Sourced]

**Sound design notes** [Engineering estimate]: The 3-cylinder gives a distinct uneven-sounding growl. Supercharged models add a high-pitched supercharger whine that rises with RPM. When the pump sucks air (jumps, hard turns), you hear the RPM shoot up to the limiter, then drop with a "bog" when the pump grabs water again.

---

## 3. Real numbers for the main Sea-Doo models

| Model | Hull | Engine | Dry weight | Length x Width | Fuel | Top speed |
|---|---|---|---|---|---|---|
| **RXP-X 325** (2025) | T3-R | 1630 ACE 325 hp supercharged | 353 kg / 778 lb | 332 x 125 cm | 70 L | about 67 to 70 mph (limited) |
| **RXP-X 300** (2021) | T3-R | 1630 ACE 300 hp | about 350 kg | similar | 70 L | **68.5 mph**, **0-60 mph in 3.6 s** (Boating Mag test) |
| **RXT-X 325** (2025) | ST3 | 1630 ACE 325 hp | 382 kg / 842 lb | 345 x 125 cm | 70 L | about 67 mph |
| **GTX Limited 325** | ST3 | 1630 ACE 325 hp | 385 kg / 849 lb | 345 cm | 70 L | about 67 mph |
| **Spark 60 / 90** | Polytec, small | 900 ACE 60 or 90 hp | about 194 to 201 kg / 428 to 443 lb | about 279 x 118 cm | 30 L | **40 mph** (60 hp), **48 mph** (90 hp) |

[Sourced: spec sheets and dealer listings, except Spark dimensions which are an engineering estimate]

- **Curb weight** (with fuel, oil, battery) adds about **55 to 60 kg**: RXP-X about 410 kg, RXT-X about 440 kg. [Reviewer: Jet Drift estimates]
- **Rider capacity** for RXT-X: 272 kg (600 lb). [Sourced]
- **Speed limit agreement:** Since a 1999 voluntary agreement with the US Coast Guard, makers cap stock skis around **65 mph (plus about 2 mph tolerance, so about 67 mph)**, measured with a 200 lb rider and full fuel on calm water. In practice, top skis now hit about 67 to 70 mph. [Sourced: Powersports Business]

---

## 4. The hulls: why each Sea-Doo turns differently

### 4.1 T3-R (RXP-X, the race/performance hull)

- **Rounded outer chines** so the hull can **lean over hard and carve** through corners, like a motorbike. Older race hulls had hard, sharp chines that limited lean. [Reviewer]
- **Ergolock** rider system: a **narrow hourglass seat** you grip with your knees, **knee pads**, and **angled footwells** that let you brace your feet and push. The rider becomes locked to the hull, so body weight transfers straight into the hull during turns. [Reviewer]
- **Adjustable rear sponsons** (small fins on the sides at the back), **3 positions**. Sponsons **down = more bite in corners**, **up = looser, more forgiving**. Small winglets on them add grip and help stop **chine walk** when leaned over. [Sourced: Sea-Doo spec sheet; Reviewer]
- Narrow, sharp, aggressive. Rewards an active rider, punishes a lazy one.

### 4.2 ST3 (GTX, RXT-X, Wake Pro: touring/rough water)

- BRP says **20 degrees of deadrise** (how V-shaped the bottom is) with a sharper entry at the front, and markets it as the most **stable** hull. [Sourced]
- One expert reviewer disagrees: they say it is **fairly flat in the middle**, so it is very stable at low speed but less of a true rough-water deep-V than claimed. [Reviewer: Watercraft Journal]
- **Wider and lower centre of gravity** = very stable, comfortable, dry ride. Turns are more predictable and less "leany" than T3-R. [Reviewer]

### 4.3 GTI / Polytec (recreation)

- Hull made from **Polytec** (polypropylene with long glass fibres): light, tough, cheaper. [Sourced]
- Mild, friendly handling. Good beginner ski in the game.

### 4.4 Spark (light and playful)

- Very light (about 200 kg). **Loose, flickable, fun**, but gets thrown around more by waves. [Reviewer]
- With extended VTS it pops the bow up easily for wheelies/tail-stands. [Reviewer]
- Feels stable solo, but **adding passengers in the wrong place** (or three people leaning the wrong way) can tip it. [Reviewer]

**Key hull vocabulary for the game**

- **Deadrise:** angle of the V at the bottom. More = cuts waves smoother, but less stable at rest.
- **Chine:** the edge where the bottom meets the side. Sharp chines grip/hook, rounded chines lean and carve.
- **Keel:** the centre-line spine at the bottom. Gives straight-line tracking.
- **Sponsons:** fins on the rear sides. Give side grip in turns.
- **Strakes:** small ridges along the bottom that help lift and grip.

---

## 5. Weight distribution: the most important part for realism

This is where a jet ski is very different from a car. **The rider is a big part of the total weight**, and they move.

| | Mass | Share of total |
|---|---|---|
| RXP-X with fuel | about 410 kg | about 84% |
| One 80 kg rider | 80 kg | about 16% |
| Spark with fuel | about 225 kg | about 74% |
| One 80 kg rider on a Spark | 80 kg | about 26% |

[Engineering estimate from the spec numbers above]

So a rider moving 30 cm forward or sideways shifts the centre of gravity (CG) noticeably, and on a Spark it shifts a lot.

### 5.1 Where the weight sits

- The **engine is low and in the middle** of the hull, just behind the middle, under the seat. The **fuel tank is in front of the engine**. The **pump is at the very back**. [Engineering knowledge]
- The rider sits **above and slightly behind** the machine's own CG, so the rider **raises the overall CG** and **moves it back**. [Engineering estimate]
- **Fuel burn moves the CG**: a full 70 L tank is about 52 kg in front of the engine. As fuel burns, the nose gets lighter and the bow rides higher. [Engineering estimate]

### 5.2 Forward and back weight (pitch)

- **Weight too far back** is the **number one cause of porpoising** (the bow bouncing up and down at speed). **Fix: move forward.** [Sourced: Personalwatercraft.com, Jet Drift]
- Weight too far back also causes **too much bow rise** on acceleration and **loose steering** because the front is barely touching the water. [Sourced]
- **Weight forward** (leaning or standing over the bars) **plants the bow**, improves grip and turning, and **gets the ski on plane faster**. [Reviewer]
- **Too far forward** in waves can make the bow **stuff** (dig into the back of a wave), which can stop the ski suddenly or throw the rider. [Reviewer/Engineering estimate]
- A **passenger** on the back moves CG backwards: more bow rise, more porpoising risk. Use **trim down** to correct. [Sourced]

### 5.3 Side-to-side weight (roll) and turning

- Riders **lean into the turn** to keep balance and help the hull carve. Small body weight changes noticeably change how the hull responds. [Sourced: Personalwatercraft.com]
- **How leaning actually helps** [Engineering explanation]: when the hull rolls inward, the inside chine digs in and the bottom tilts, so part of the hull's planing lift now points **sideways toward the inside of the turn**. That sideways force is what lets the ski carve instead of sliding. A ski that is not leaned has only the keel and sponsons to resist sliding, so it skids.
- **Not leaning enough / too much speed in a hard turn:** the back **slides out** (spin-out). [Reviewer: Jet Drift]
- **Hooking:** when the bow or a sharp chine suddenly digs in and the ski turns violently, often throwing the rider. Causes: too much trim, too much speed for the turn. [Sourced: HSBO marine accident study]
- Riders keep **knees bent, core tight**, weight centred, and **look where they want to go**. [Reviewer]

### 5.4 Sitting vs standing

- **Sitting:** lower CG, stable, but weight tends to be too far back.
- **Standing / kneeling up:** weight moves **forward and higher**, legs act as **suspension** in chop, and the rider can throw weight side to side more quickly. Standing is how experienced riders handle rough water and aggressive turns. [Reviewer/Engineering estimate]

---

## 6. Handling behaviours to simulate

### 6.1 Getting on plane

- At low speed the hull is **displacing** (pushing water aside, like a normal boat). It sits low, bow high, and makes a big wake.
- As speed rises it climbs over its own bow wave (the **"hump"**: drag peaks here, bow rises most here), then the hull **rides up on top of the water (planing)**. Drag per unit speed drops, the bow levels out, and it accelerates freely. [Sourced: boat design forums]
- **Planing speed** for a PWC is roughly **15 to 25 mph**, sooner with more power, lighter rider, and weight forward. [Engineering estimate]
- On a 300 hp ski this happens in about 1 second at full throttle, but on a Spark with two people it is a visible struggle. [Engineering estimate]

### 6.2 Porpoising

- Bow bounces up and down rhythmically at speed. Caused by weight too far back, trim too high, hard acceleration, or choppy water. **Fix: move forward, trim down, ease throttle.** [Sourced]
- In planing-hull physics, porpoising starts when the trim angle passes a critical value for that hull's deadrise (Savitsky's work). [Sourced: Savitsky/openplaning]

### 6.3 Chine walk

- A side-to-side rocking and yawing oscillation that happens at high speed when riding on the very back of the hull (trimmed up, bow high). Fix: trim down or ease off. Sea-Doo sponson winglets are designed to reduce it. [Sourced: Virginia Tech study; Reviewer]

### 6.4 Spin-out and sliding

- Hard turn at high speed: the stern breaks loose and slides out. Leaning more, sponsons lower, or less speed prevents it. [Reviewer]

### 6.5 Ventilation and cavitation

- **Ventilation:** air gets into the pump when the intake leaves the water (jumping waves, hard leaned turns, big chop). The impeller suddenly has no load, so **RPM shoots up to the limiter and thrust disappears**. When it hits water again it grabs suddenly (a jolt). [Sourced/Reviewer]
- **Cavitation:** vapour bubbles form in the pump from a worn wear ring, damaged impeller, or debris. Causes loss of power, noise, and vibration. Good for a "damage" system in the game. [Reviewer]
- Sharp throttle stabs in a turn can make the pump lose grip and reduce steering. [Reviewer]

### 6.6 Jumping waves and landing

- **In the air: no thrust and no steering** (the pump is out of the water). The rider can still shift body weight to change the pitch attitude a little. [Reviewer]
- Engine over-revs while airborne. Experienced riders **ease off the throttle in the air** then roll it back on at landing to avoid shock to the pump. [Reviewer]
- **Landing flat** puts big stress on the hull, engine mounts, and the rider's body. **Landing slightly nose-first / angled** (letting the V cut in) is softer. [Forum]
- **Nose too low on landing:** bow stuffs, the ski decelerates violently and can throw the rider over the bars. **Tail too low:** the ski can slap down, or flip backwards on big jumps. [Engineering estimate]
- Bent knees absorb landing. [Reviewer]

### 6.7 Low speed and docking

- Minimal steering at idle without a little throttle. Wind and current push the ski around. [Sourced]
- With iBR you can go forward, neutral, and reverse at idle. **Steering feels reversed when backing up.** [Reviewer]

### 6.8 Capsizing and righting

- If the ski flips over, the rider **must turn it back the right way** (Sea-Doo puts an upside-down sticker on the back showing the direction, typically **clockwise when looking at the stern**) to stop water getting into the engine. [Sourced: Sea-Doo manuals]
- **Don't restart while upside down.** If capsized more than about 5 minutes, don't crank the engine. [Sourced: Sea-Doo manual]
- **Lanyard / safety key:** a cord clipped to the rider's life jacket. If the rider falls off, it pulls off and the engine stops. [Sourced]

---

## 7. Suggested physics model for the game

This turns the research into a simulation plan. Most numbers here are **[Engineering estimates]** to tune by feel.

### 7.1 Rigid body

- One rigid body with 6 degrees of freedom: position, velocity, rotation (pitch, roll, yaw), and angular velocity.
- Mass = hull curb mass + rider + passenger + fuel remaining.
- **CG** = weighted average of hull CG, rider CG (which moves with player input), passenger CG, and fuel CG.
- **Moment of inertia** recomputed when the rider moves (rough estimate for RXP-X: roll about 80 to 120 kg m², pitch about 350 to 500, yaw about 350 to 500).

### 7.2 Hull and water forces (sample the hull at points)

Split the hull bottom into a grid of about 20 to 40 sample points. For each one that is underwater:

1. **Buoyancy:** pushes up, proportional to how deep that point is. This makes it float and rock correctly at rest.
2. **Planing lift:** pushes along the hull-bottom normal, proportional to `speed² x local angle of attack`. This lifts the ski onto the plane at speed and gives the "hump".
3. **Drag:** skin friction proportional to wetted area x speed², plus extra drag at the hump.
4. **Side grip:** resists sideways sliding. Comes from the keel, chines, and sponsons. Higher when the hull is leaned into the turn and when sponsons are low. If the sideways force needed is more than the grip available, the stern slides (spin-out).

Because the forces act at real points on the hull, **moving the rider's CG automatically changes the pitch and roll balance**, which gives porpoising, bow rise, and carving for free.

### 7.3 Pump and engine

```
rpm_target  = from throttle position and pump load
pump_load   ∝ rpm² * intake_water_fraction
thrust      = k * rpm² * intake_water_fraction * (1 - V_boat / V_jet)
```

- `intake_water_fraction` drops toward 0 when the intake point is out of the water (jumps, extreme lean). Then load drops, RPM spikes to the limiter, and thrust vanishes.
- Thrust is applied at the **nozzle position**, in the **nozzle direction** (steering angle left/right, VTS trim angle up/down).
- iBR bucket: blends thrust direction from backwards to forwards based on lever pressure. Neutral = cancel out.
- Throttle-by-wire smoothing depends on the riding mode (Touring is soft, Sport is sharp, ECO caps RPM).

### 7.4 Rider model (the player's body)

Separate controls for:
- **Lean left/right:** moves rider CG sideways (about plus or minus 30 cm) and adds a little roll torque.
- **Lean forward/back:** moves rider CG forward/back (about plus or minus 40 cm).
- **Stand up/sit down:** raises CG and allows faster weight shifts; standing absorbs bumps.
- If forces on the rider are too big (hard hook, nose stuff, hard landing), the rider is **thrown off**, the **lanyard kills the engine**, and the ski drifts.

### 7.5 Starting tuning targets (RXP-X 325, 80 kg rider, flat water)

| Test | Target |
|---|---|
| 0-60 mph | about 3.4 to 3.6 s |
| Top speed | about 67 to 70 mph |
| Planing speed | about 15 to 20 mph |
| Rev limiter | about 8,250 rpm |
| Full throttle fuel burn | about 22 US gal/h |
| Brake stop with iBR vs no brake | up to 48 m shorter |

For a Spark 90 target about 48 mph top speed and a much slower launch.

---

## 7A. Trim (VTS) limits: factory vs upgraded

### What we know

| Setup | Trim up | Trim down | Total range | Trust |
|---|---|---|---|---|
| **Spark, standard VTS** | about **+7 degrees** | about **-4.5 degrees** | about 11.5 degrees | Reviewer (PWC review); the +7 also matches the Trixx figure minus its extra 10 degrees |
| **Spark Trixx (extended VTS, standard on Trixx)** | **+17 degrees** | **-6 degrees** | about 23 degrees (double standard) | Sourced: Boating Mag Trixx review |
| **Extended-range VTS accessory for Spark** (part 295100704) | same as Trixx | same as Trixx | "double the range" | Sourced: BRP shop. Full range only on 2017+ Spark with iBR; 2016 and older stay at stock range |
| **Old Sea-Doo SP (1990s)** | **+8 degrees** at full up | not stated | | Sourced: SP shop manual |
| **GTI / GTX / RXT / RXP-X, standard VTS** | not published | not published | one owner measured only about 1 inch (25 mm) of nozzle sweep top to bottom | Forum |
| **X Package Module** (RXT, GTX, Wake Pro 2018+, GTI/GTR/GTS 2020+) | | | **+50% more range** than standard (one listing says 30%) | Reviewer/retailer |
| **RXP-X / RXT-X (X models)** | | | come with **extended VTS + launch mode** from the factory | Sourced: spec listings |

### What the extra trim actually does

- The **Trixx's extra 10 degrees of UP trim** is what matters most. It points the jet downward so it **pushes the back down and the nose up**, so the ski pops into **wheelies and tail-stands** with very little throttle. [Sourced: Boating Mag]
- The extra **DOWN trim** was meant to help stab the nose into the water after jumps or "sub" the nose (dive it under), but the reviewer found those moves actually **harder**. [Sourced: Boating Mag]
- **Double-tap the trim button up** to jump straight to full up, and **double-tap down** to go back to neutral (Spark). [Forum]
- **Launch mode** (X models): trims fully down for the start so the nose doesn't lift, then trims up automatically as speed rises. One test found riders **could not beat it by trimming by hand**. [Reviewer: Greenhulk]

### Other Trixx parts that change weight distribution

- **Height-adjustable handlebar riser**: lets the rider stand taller and **move their centre of gravity** up and back for tricks. [Sourced: Red Dot design award page]
- Trixx models also have **angled footwell wedges** so the rider can brace and lever the ski. [My knowledge, not confirmed by a source in this search]

### Aftermarket

- I found **no aftermarket kit that adds more trim degrees** to the RXP-X or RXT-X beyond BRP's own extended VTS and X Package. [Search result]
- Aftermarket parts change the **feel** without changing trim range: adjustable **sponsons** (RIVA Pro-Series has 5 positions), **ride plates**, **intake grates**, and **handlebar extensions/risers**. RIVA's sponsons also push the ST3 hull's nose down a bit. [Reviewer: Watercraft Journal]

### Suggested game values [Engineering estimate, tune by feel]

| Game setting | Up | Down |
|---|---|---|
| Standard VTS (GTI, GTX, RXT) | +6 degrees | -5 degrees |
| X Package / X model extended VTS (x1.5) | +9 degrees | -7.5 degrees |
| Spark standard | +7 degrees | -4.5 degrees |
| Spark Trixx / extended VTS (x2) | +17 degrees | -6 degrees |
| "Unlocked" fantasy mod (not real, for fun) | +25 degrees | -10 degrees |

The trim motor in the game should take about 2 to 3 seconds to go from full down to full up, not jump instantly. [Engineering estimate]

---

## 7B. 3D models of Sea-Doos (and other jet skis)

**About licences:** "CC Attribution" (CC-BY) means free to use, even in a game, as long as you **credit the author**. "Editorial only" means you **cannot** use it in a game. Also, real Sea-Doo models carry **BRP's logos and trademarks**. That is fine for a personal or school project, but publishing a game with real Sea-Doo branding would need BRP's permission. A safe route is to use the shape and remove or replace the logos.

I could not open Sketchfab directly (this environment blocks it), so check each licence on the page yourself.

### Free

| Model | Where | Licence | Detail | Notes |
|---|---|---|---|---|
| **2012 Sea-Doo GTI SE 130** by BoatUS Foundation | [Sketchfab](https://sketchfab.com/3d-models/2012-sea-doo-gti-se-130-d7b3e903d7dc43a694720bd347f4fadf) | Free download (check licence) | Unknown | **The only free real Sea-Doo found.** Best starting point |
| **UNDERPOLY Free Jet-Ski + Trailer** | [Sketchfab](https://sketchfab.com/3d-models/underpoly-free-jet-ski-trailer-c9e324b0a9284904b4a442080fc2a6ef) | CC Attribution | about 2,500 polygons, low poly, made for Unity | Generic, great for a fast web game |
| **Kawasaki 310X Ultra** by XOIAL | [Sketchfab](https://sketchfab.com/3d-models/kawasaki-310xultra-jet-ski-37a2348f02da472d98310fd5621307c6) | CC Attribution, author says "use where you want" | about 8,200 triangles | Not a Sea-Doo but a good game-ready size |
| **Jetski** by appsnation | [Sketchfab](https://sketchfab.com/3d-models/jetski-15e79c65f67a468592cdc2ac1f5b389b) | CC Attribution | 1.2 million triangles | Too heavy for a game unless simplified in Blender |
| **Stand-up Jet Ski** by daftpy | [Sketchfab](https://sketchfab.com/3d-models/stand-up-jet-ski-d7b63daa9bb94c7ca00733201b0ecae7) | Check page | about 2,100 triangles | Stand-up style, not a sit-down Sea-Doo |
| More | [Sketchfab "sea-doo" tag](https://sketchfab.com/tags/sea-doo), [Sketchfab "seadoo" tag](https://sketchfab.com/tags/seadoo), [Sketchfab "jetski" tag](https://sketchfab.com/tags/jetski) | Mixed | | Filter by "Downloadable" |

### Paid Sea-Doo models

| Model | Where | Price | Notes |
|---|---|---|---|
| **Sea-Doo GTX Limited 325 (2025)** | [CGTrader](https://cgtrader.com/3d-models/watercraft/recreational-watercraft/jetski-seadoo-gtx-325-2025-3d-model-game-and-highpoly) | about $15 | **Best paid option**: includes a game-ready low-poly version, 4K PBR textures, royalty-free |
| Sea-Doo Spark | [TurboSquid](https://www.turbosquid.com/3d-models/jet-ski-sea-doo-spark-personal-watercraft-1038172) / [Free3D](https://free3d.com/3d-model/sea-doo-spark-2842.html) | about $79 | about 26,000 polygons |
| Sea-Doo RXT-X 300 (2019) | [TurboSquid](https://www.turbosquid.com/3d-models/sea-doo-rxt-x-300-performance-model-1372312) / [Free3D](https://free3d.com/3d-model/sea-doo-rxt-x-300-red-performance-watercraft-2019-8850.html) | about $41 to $79 | about 85,000 polygons, **TurboSquid version is editorial only** |
| Sea-Doo RXT 260 | [Free3D](https://free3d.com/3d-model/personal-watercraft-sea-doo-rxt260-2363.html) | about $39 | about 75,000 polygons |
| Sea-Doo GTR 215 | [CGTrader](https://www.cgtrader.com/3d-models/watercraft/recreational-watercraft/sea-doo-gtr-215) / [RenderHub](https://www.renderhub.com/digitalart3d/sea-doo-gtr-215) | varies | |
| Sea-Doo FishPro 2021 | [CGTrader](https://www.cgtrader.com/3d-models/watercraft/recreational-watercraft/seadoo-fishpro-2021) | varies | |
| Sea-Doo high performance (RXP-style) | [RenderHub](https://www.renderhub.com/formadigitalcreative/seadoo-high-performance-jet-ski) | varies | |

**No RXP-X model** turned up, free or paid.

**Recommendation for the game:** Start with the free **BoatUS GTI SE 130** (real Sea-Doo shape) or the **UNDERPOLY** low-poly ski to build the physics. Then, if you want a modern Sea-Doo look, buy the **$15 CGTrader GTX 325** because it already has a game-ready version.

---

## 8. Gaps and things to check later

- No source gave a measured **lean angle** for the T3-R hull, the exact **CG position**, or **moments of inertia**. These need tuning by feel.
- No exact **planing speed** from Sea-Doo. 15 to 25 mph is an estimate.
- The ST3 "deep-V" claim is disputed between BRP and a reviewer.
- I could not open some full articles (the environment blocked page fetching), so details came from search summaries. The key ones to read in full if we want more detail: Personalwatercraft.com "PWC 101: Handling" and "PWC Riding and Turning Techniques".
- For accurate planing physics, Savitsky's 1964 paper "Hydrodynamic Design of Planing Hulls" is the standard method. The open-source Python package `openplaning` uses it.

---

## Sources

- [SBT: Overview of Jet Ski Pump Assemblies](https://sbt.com/blogs/technical/a-quick-overview-of-jet-ski-pump-assemblies)
- [SBT: Anatomy of a Jet Ski Powertrain](https://sbt.com/blogs/technical/understanding-the-anatomy-of-a-jet-ski-powertrain)
- [UTI: How Does a Jet Ski Work](https://uti.edu/blog/marine/personal-watercraft)
- [Jet Drift: Wear Ring](https://www.jetdrift.com/jet-ski-wear-ring/)
- [Jet Drift: Nozzle](https://www.jetdrift.com/jet-ski-nozzle/)
- [MIT OCW: Waterjet propulsion notes](https://ocw.mit.edu/courses/2-611-marine-power-and-propulsion-fall-2006/3b26401197d2c93c660289c51fa8e7bb_04waterjet.pdf)
- [BRP: Intelligent Brake and Reverse](https://sea-doo.brp.com/us/en/discover/technologies/vehicle-technologies/ibr.html)
- [Personalwatercraft.com: iBR Explained](https://personalwatercraft.com/features/seadoo-intelligent-brake-reverse-explained-video-1220.html)
- [Jet Drift: Sea-Doo iBR](https://www.jetdrift.com/sea-doo-ibr/)
- [Sea-Doo GTS manual: iControl / VTS / Capsize pages (ManualsLib)](https://www.manualslib.com/manual/1064178/Sea-Doo-Gts.html?page=18)
- [Sea-Doo GS manual: Variable Trim System](https://www.manualslib.com/manual/804042/Sea-Doo-Gs5847.html?page=52)
- [Jet Drift: Sea-Doo VTS](https://www.jetdrift.com/sea-doo-vts/)
- [Patent US8000851B2: Automatic trim system for jet watercraft](https://patents.google.com/patent/US8000851)
- [Boats.com: New ST3 platform for GTX/RXT/Wake Pro](https://www.boats.com/reviews/sea-doo-reveals-all-new-platform-for-gtx-rtx-and-wake-pro-models)
- [Sea-Doo: Hull technologies](https://sea-doo.brp.com/gb/en/sea-doo-life/technologies/hull.html)
- [Jet Drift: Sea-Doo Hulls](https://www.jetdrift.com/sea-doo-hulls/)
- [Watercraft Journal: GTX Limited 300 / ST3 review](https://watercraftjournal.com/gallery-2022-sea-doo-gtx-limited-300-video/)
- [Personalwatercraft.com: PWC Riding and Turning Techniques](https://personalwatercraft.com/features/pwc-riding-and-turning-techniques-1061.html)
- [Personalwatercraft.com: Three Common PWC Handling Mistakes](https://personalwatercraft.com/features/how-to-avoid-three-common-pwc-handling-mistakes-1297.html)
- [Personalwatercraft.com: Ride to Match the Conditions](https://personalwatercraft.com/features/how-to-ride-your-pwc-to-match-the-conditions-1232.html)
- [Personalwatercraft.com: PWC 101 Handling](https://personalwatercraft.com/features/pwc-101-handling-1005.html)
- [Watercraft Journal: Three Common PWC Handling Errors](https://watercraftjournal.com/three-common-pwc-handling-errors-and-how-to-correct-them/)
- [A2Z Powersport: Do You Lean Into a Turn on a Jet Ski](https://a2zpowersport.com/?p=4129)
- [Jet Drift: Jet Ski Porpoising](https://www.jetdrift.com/jet-ski-porpoising/)
- [Jet Drift: Common Handling Errors](https://jetdrift.com/most-common-jet-ski-handling-errors)
- [Virginia Tech/APS: Stepped planing hull chine walk study](https://archive.aps.org/dfd/2025/z26/1)
- [HSBO: Mechanics of Boat Accidents](https://hsbo.org/wp-content/uploads/2023/04/19-HSBO-2014-Mechanics-of-Boat-Accidents-4-min.pdf)
- [Drive a Boat USA: Steering Control on a PWC](https://driveaboatusa.com/blog/steering-control-pwc/)
- [Jet Drift: Sea-Doo OPAS](https://www.jetdrift.com/sea-doo-opas/)
- [Chieftain Training: Cavitation and Ventilation](https://chieftain.training/propeller-cavitation-propeller-ventilation-explained/)
- [Jet Drift: RXP-X 325 Review](https://www.jetdrift.com/rxp-x-325-review/)
- [Jet Drift: RXT-X 325 Review](https://www.jetdrift.com/rxt-x-325-review/)
- [Jet Drift: GTX Limited 325 Review](https://www.jetdrift.com/sea-doo-gtx-limited-325-review/)
- [BRP 2026 RXP-X spec sheet (PDF)](https://atvdealers.pl/wp-content/uploads/2025/08/SEA-2026-Performance-RXP-X-Spec-EN-Page-LR_compressed.pdf)
- [BRP 2026 RXT-X spec sheet (PDF)](https://atvdealers.pl/wp-content/uploads/2025/08/SEA-2026-Performance-RXT-X-Spec-EN-Page-LR_compressed.pdf)
- [Boating Mag: 2021 RXP-X 300 test](https://boatingmag.com/story/boats/2021-sea-doo-rxp-x-300-bbg/)
- [Watercraft Journal: RXP-X 300 vs GP1800R SVHO](https://watercraftjournal.com/video-2021-sea-doo-rxp-x-300-vs-2021-yamaha-gp1800r-svho-shootout/)
- [Boating Mag: Sea-Doo 1630 ACE](https://boatingmag.com/sea-doo-1630-ace/)
- [Boating Mag: New 325 hp Rotax 1630 ACE](https://boatingmag.com/boats/new-325-hp-rotax-1630-ace-engine/)
- [Jet Drift: Sea-Doo Engines](https://www.jetdrift.com/sea-doo-engines/)
- [Boating Mag: Sea-Doo Spark](https://www.boatingmag.com/sea-doo-spark/)
- [Sea-Doo: Polytec Hull](https://sea-doo.brp.com/gb/en/sea-doo-life/technologies/polytec.html)
- [Powerboat & RIB: Sea-Doo Spark test](https://powerboatandrib.com/boat-tests/seadoo-spark)
- [Personalwatercraft.com: 2013 RXP-X 260 Review](https://personalwatercraft.com/manufacturers/sea-doo/2013-seadoo-rxpx-260-review-1160.html)
- [Jet Drift: Ergolock System](https://jetdrift.com/sea-doo-ergolock-system)
- [Sea-Doo RXP-X 260 spec sheet (PDF)](https://sea-doo.brp.com/content/dam/seadoo/Global/MY2015/Documents/Lineup/_16RXP-X260_SS_15_EN.pdf)
- [Watercraft Journal: Sponson Design and Fluid Dynamics](https://watercraftjournal.com/gallery-understanding-fluid-dynamics-in-relation-to-superior-sponson-design/)
- [RIVA / Solas 161 mm pump](https://rivaracing.com/rivasolas-sea-doo-14-vane-pump-161mm-sx-pm-16183.html)
- [Jet Drift: Sea-Doo iTC](https://www.jetdrift.com/sea-doo-itc/)
- [Jet Drift: Sea-Doo Modes](https://www.jetdrift.com/sea-doo-modes/)
- [Steven in Sales: Sea-Doo Driving Modes](https://steveninsales.com/sea-doo-driving-modes-keys-explained/)
- [Jet Drift: Sea-Doo Fuel Consumption](https://jetdrift.com/sea-doo-fuel-consumption)
- [Powersports Business: Flirting with the speed limit (2006)](https://powersportsbusiness.com/features/2006/12/04/flirting-with-the-speed-limit-december-4-2006/)
- [Sea-Doo: Water in the engine](https://sea-doo.brp.com/ca/en/owner-zone/getting-started/vehicle-information/water-in-personal-watercraft-engine.html)
- [Personalwatercraft.com: How to Right a Capsized PWC](https://personalwatercraft.com/features/how-to-right-a-capsized-pwc-1317.html)
- [Discover Boating: Docking a PWC](https://discoverboating.com/resources/docking-a-jet-ski-personal-watercraft-waverunner)
- [Steven in Sales: How to Dock a Jet Ski](https://steveninsales.com/how-to-dock-a-jet-ski/)
- [openplaning (Savitsky method in Python)](https://openplaning.readthedocs.io/en/latest/readme.html)
- [Boat Design Net: Savitsky method discussion](https://www.boatdesign.net/goto/post?id=167568)
- [Boat Design Net: Transition from plow to plane](https://www.boatdesign.net/goto/post?id=848763)
