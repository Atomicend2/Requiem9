# Project Logs Breakdown

Here is the breakdown of your logs, grouped logically into clear categories, with explanations for each point.

## 1. Critical Bug Fixes & Errors
Immediate issues that need debugging and fixing in the backend or UI.

- **Instance Crash (Status 134):** The server or instance failed with "Exited with status 134" (specifically instance `hlbt6`). This is crashing the code and requires a review of the service logs.
- **Card Commands Failure:** Commands related to cards (like `.ci`, `.ss`) are failing. The bot only reacts to the message but does not send the actual card image/video.
- **Dungeon NaN/Undefined Errors:** The `.dungeon` feature is broken due to null/missing data.
  - Damage calculation results in `NaN`.
  - Dungeon floor, monster names, levels, and enemy health bars return `undefined` or `NaN`.
- **Duplicate Items in Card File:** `unified_cards.jsonl` contains exact duplicates where the name, ID, URL, and tier match perfectly. These duplicates need to be found and removed.
- **Bank Capacity Bug:** After purchasing bank notes in the web shop, the system still displays a "not enough bank capacity" error when trying to use them.

## 2. System Architecture & Core Philosophy
The structural vision of the project — moving away from a basic chat bot and into a persistent MMO world simulation.

- **World-First Approach:** The game is not a traditional linear chat RPG (`.rpg` → class → quest → level up). Instead, it is a persistent MMO world running inside WhatsApp that evolves even when players are offline.
- **`.rpg` Command as a Dashboard:** The `.rpg` command handles no gameplay. It acts strictly as a visual status dashboard showing global context (world date, global events) and personal standing (level, guild, location, influence, territory).
- **`.dungeon` Command as Live Gameplay:** This is where active gameplay happens. It generates dynamic instances (dungeon name, floor, threat level, objective) and provides contextual choices (e.g., explore hall, open door, retreat) that generate new rooms dynamically.
- **Live Web Synchronization:** The website must not show static text or separate lore. It must act as a live visual representation of the active database state (e.g., if a guild conquers a territory in-game, the website map updates automatically).
- **High-Level Database Structure:** The database architecture must reference a centralized `WorldState` collection/table.
  - **Core Collections:** Player, Guild, Territory, Region, Continent, Quest, Dungeon, Event, Faction, Property, WorldState.
  - **WorldState Controls:** `currentDay`, `currentSeason`, `activeEvents`, `worldThreatLevel`, `economyMultiplier`.

## 3. Gameplay Mechanics & Systems
Structural gameplay features that need to be developed for the persistent world.

- **World Atlas Hierarchy:** A nested geographical structure used for navigation and economy: Continents (e.g., Aetheris) → Regions (e.g., Whisper Woods) → Territories (e.g., Silent Lake).
- **Territory & Guild Economy:** Territories within regions have specific owners (guilds), resource types, passive income generation, and tax rates. Guilds fight for control over these territories to reap the passive income and upgrade them.
- **Strict Guild Creation:** Guild creation must be rare and difficult to achieve. It requires: Level 50, 100,000 gold, 10 signatures, and a highly limited "Guild License" sold only by the World Authority (capped at 3 licenses per month globally).
- **Dynamic Guild Ranks:** Guilds are ranked from Rank F to Rank S/SS based heavily on performance metrics: territory count, member count, global influence, wealth, and achievements.
- **Event Chain Engine:** An automated engine (`generateWorldEvent()`) triggers global events (political, economic, military, environmental) every few hours. These events chain into each other dynamically (e.g., Mana Storm → Monster Mutation → Refugee Migration).
- **Random Quest Generator:** Quests are never static. They are dynamically generated using a structural formula: [Issuer] + [Problem] + [Location] + [Reward].
- **Reputation System:** Player choices affect standing across multiple independent factions (Empire, Mages, Hunters, Guilds, Merchants, Criminals).
- **Class System Rework:** Classes must not lock players out of story content. Instead, they dictate *how* a problem is solved (e.g., opening a sealed gate: Warrior breaks it, Mage dispels it, Rogue picks the lock).
- **Late-Game Land Ownership:** Players can passively generate income by purchasing properties: houses, farms, shops, forts, or castles. Guilds can purchase larger scales like districts, towns, or entire regions.

## 4. Shop & Item Logic
New items to be integrated into both the in-game shop and web shop, along with their specific functional logic.

- **Shovel:** Required item to enable the digging mechanic.
- **Pistol:** Strictly used for stealing directly from player wallets.
- **Debit Card:** Allows players to purchase shop items and claim cards directly without performing a manual bank withdrawal.
  - *Penalty Logic:* Requires ongoing maintenance costs. If unpaid, it expires or triggers a specific punishment system (rules must be clearly communicated to users).
- **Map:** Used within the RPG system to locate hidden treasures and discover new map locations.
- **Rename Sheet:** A consumable item used to change a player's name.
- **Lottery Ticket:** A ticket to enter the lottery system (needs a physical purchasing spot/menu created).
- **Health Pack:** Standard consumable tool used for recovery during RPG activities.
- **Dynamic Equipment Shop:** The shop must detect the user's active class dynamically and display corresponding class-specific gear and materials required for dungeon diving.
- **Registration Bonus:** Newly registered users must receive a starting bonus of 45,000 credits/gold upon linking accounts.

## 5. UI, User Experience (UX), & Formatting
Visual adjustments to ensure the game looks clean, works within chat constraints, and displays properly.

- **Profile Card Specs:** The profile card image dimensions must be exactly 800x800.
- **Shorter Frame IDs:** Frame identification strings must be significantly shortened to make them user-friendly for commands.
- **Character Recognition:** Do not use characters/assets in the uploaded graphics if they cannot be easily recognized or scaled properly on the final profile card image.
- **Profile Card Spacing:** Clean up the visual layout of the profile card image. Space out the stats cleanly so the layout looks polished and neat.
- **Frame Equipment Bug:** Equipped frames are currently failing to render/show up visually on the profile card image.
- **Real Role Display:** The profile card text must dynamically display the player's real assigned role (e.g., ꕥ **Role:** Ascendant, Mod, User, Owner, Recruit, or Premium User).
- **Text Width Optimization:** The text format for the "Horse Gambling" feature must be optimized/shortened to fit nicely within standard WhatsApp message width constraints without wrapping poorly.
- **Group Chat Clearing Issue:** Investigate why messages are being deleted across all group chats.

## 6. Code Snippets & Technical Notes
Reference blocks for handling media sending via the WhatsApp socket (Baileys library) and data management.

- **`.jsonl` Clarification:** The `unified_cards.jsonl` extension stands for **JSON Lines**. It is not a separate programming language — it is simply a standard JSON file where every single line is its own valid, self-contained JSON object.

**Sending WebM/Video Cards via WhatsApp:**
```javascript
await sock.sendMessage(
  id,
  {
    video: {
      url: './Media/ma_gif.mp4'
    },
    caption: 'hello world',
    ptv: false // if set to true, will send as a `video note`
  }
)
```

**Sending GIFs via WhatsApp:**
```javascript
await sock.sendMessage(
  jid,
  {
    video: fs.readFileSync('Media/ma_gif.mp4'),
    caption: 'hello world',
    gifPlayback: true
  }
)
```
