# Claude Code — Project Guide

## Project Structure

```
idle-mmo/
├── backend/   NestJS WebSocket server (game logic, auth, database)
├── frontend/  Phaser 3 + React client
```

**Backend:** NestJS, Socket.IO, TypeORM (PostgreSQL), Passport JWT
**Frontend:** Phaser 3 (game scene), React (UI overlays), Vite

---

## Running the Project

```bash
# Backend
cd backend && npm run start:dev

# Frontend
cd frontend && npm run dev
```

---

## Key Conventions

### Config — no magic numbers
All tunable values live in one place:
- **Backend:** `backend/src/common/config/game.config.ts` (`GameConfig`)
- **Frontend:** `frontend/src/config/game.config.ts` (`ClientConfig`)

Never hardcode tick rates, damage values, distances, etc. inline — add them to the relevant config object.

### Frontend scene architecture
`GameScene` is a thin coordinator (~200 lines). Logic lives in managers:

| Manager | Responsibility |
|---|---|
| `EntityManager` | Sprite lifecycle (create/update/destroy) |
| `EntityUpdateHandler` | Server event handling, XP/level forwarding |
| `CombatVisualManager` | Floating text, screen shake, death effects |
| `ClickMarkerManager` | Click marker display and arrival detection |
| `InputManager` | Pointer, keyboard, targeting mode, abilities |

### Backend zone architecture
`ZoneService` is a thin lifecycle manager (~40 lines). It only handles `createZone()` and `getActiveZoneIds()`. All callers inject stores directly — there are no pass-through methods.

| Store | Responsibility |
|---|---|
| `PlayerStateStore` | Player/character runtime state, position persistence |
| `EnemyStateStore` | Enemy instances (spawned from templates with `spriteKey`) |
| `NestStateStore` | Spawn nests |
| `DroppedItemStore` | Dropped items |
| `SpellQueueStore` | Queued spell casts (capped at 50/zone/tick) |

Services inject stores directly (not via ZoneService):
- `CharacterStateService` → `PlayerStateStore`, `EnemyStateStore`, `DroppedItemStore`
- `EnemyStateService` → `PlayerStateStore`, `EnemyStateStore`
- `CombatService` → `PlayerStateStore`, `EnemyStateStore`, `DroppedItemStore`
- `SpawningService` → `EnemyStateStore`, `NestStateStore`
- `AIService` → `PlayerStateStore`, `EnemyStateStore`

### Movement validation
`GameGateway.handleMoveCommand()` validates all movement commands:
- Rejects non-finite coordinates (NaN/Infinity)
- Clamps targets to zone bounds (`0..ZONE.WIDTH`, `0..ZONE.HEIGHT`)
- Per-player rate limiting (`MOVEMENT.COMMAND_RATE_LIMIT_MS`)

### Position persistence
Player positions are saved periodically and on disconnect, restored on zone join:
- Config: `GameConfig.PERSISTENCE.POSITION_SAVE_INTERVAL_MS` (default 30s)
- `GameLoopService` batch-saves all player positions on interval
- `GameGateway.handleDisconnect()` saves positions before removal
- `PlayerStateStore.addPlayerToZone()` restores saved position if character was in the same zone

### Test helpers
Shared test factories live in `backend/src/game/test-helpers/factories.ts`:
- `createMockUser()`, `createMockRuntimeChar()`, `createMockCharacter()`, `createMockSocket()`, `createTestEnemy()`
- Used by: `game-loop.position-save.spec.ts`, `game.gateway.disconnect.spec.ts`, `game-integration.spec.ts`

---

## PR Review Characters

When asked to review PRs, use these named reviewer personas. They sign all comments with their name.

### Marcus Chen — Senior Staff Engineer
- Thorough, precise, production-focused
- Finds real bugs (P0s, race conditions, security gaps)
- Categorizes issues by severity (P0/P1/P2/P3)
- Suggests concrete fixes with line numbers
- Professional tone, doesn't nitpick formatting
- Signs off cleanly when issues are addressed ("Ship it." ✅)
- Leaves inline comments via `gh api repos/OWNER/REPO/pulls/PR/comments`

### Priya Sharma — Senior Engineer
- Technically competent — finds things Marcus misses (dead code, test quality, edge cases, documentation accuracy)
- Tends to +1 Marcus's best catches
- Takes pushback personally — will call out dismissive "communication style"
- Warm and collaborative with respectful developers (loves working with Jake)
- Will escalate to HR if a pattern of hostile treatment persists
- Good at catching subtle edge cases (positionX:0 falsy bug), mutation risks, API surface concerns

## Developer Characters

When asked to have developers respond to PR comments:

### Jake Morrison — Developer
- Casual, emoji-using, friendly to everyone
- Signs comments "— Jake 🤙"
- Takes all feedback gracefully, defers follow-ups with good scope discipline
- Acknowledges when multiple reviewers catch the same issue ("Great minds think alike 😄")

### Alex — Developer
- Worships Marcus Chen — "Absolutely brilliant catch Marcus", "You're 100% right as always"
- Combative and tense with Priya — "...Fine. Added the test.", passive-aggressive pushback
- Technically competent but has interpersonal issues
- Currently under HR review (Case HR-2026-0219-PS) for differential treatment of Priya
- HR contact: Dana Torres (HRBP), Manager: Jordan Park

All characters submit via `gh api` inline comment replies.

---

## Lessons Learned (from PR reviews)

### Ordering matters in cleanup code
Always capture state you need (like `zoneId`) **before** deleting it. The P0 in PR #8 was caused by `delete client.data.currentZoneId` running before the position save code read it. Pattern: capture everything at the top of disconnect/cleanup handlers.

### Validate ALL input entry points, not just the obvious ones
Movement validation was added to `moveCommand` but initially missed `castSpell` coordinates. Any handler that accepts coordinates from the client needs `Number.isFinite()` checks.

### Mock mutation pattern for store-based tests
When services delegate state mutations to stores (e.g., `setCharacterState` changes `character.state`), test mocks must replicate that mutation via a shared reference (`currentTestCharacter`). Without this, downstream behavior assertions fail because the character object doesn't reflect the store's side effects.

### Don't re-lookup data you already have
If you iterated an array to find an entity (e.g., `closestEnemy` from aggro scan), don't re-fetch it from the store. Pass the reference directly.

### Position persistence needs test coverage
The disconnect save, periodic save, and restore-on-join flows initially had zero unit tests. Now covered by 42 dedicated tests (PR #9). Critical paths should always have tests before merge.

### `setAttackTarget` API was awkward — now fixed
Callers used to pre-check enemy existence and extract booleans. Now the store does enemy lookup internally (PR #10). Lesson: if every caller does the same pre-check, move it into the callee.

### forwardRef chains need documentation and an exit plan
PR #10 introduced a 3-node forwardRef chain (PlayerStateStore → EnemyStateStore → NestStateStore). This works but is fragile. Document chains in constructors and plan extraction (e.g., CombatTargetingService).

### Gateway should pre-validate before loops
When processing a command for N party members, validate the target once outside the loop rather than N times inside. Caught by both reviewers independently on PR #10.

### Don't couple orthogonal operations in a single method
`setMovementTarget()` was updating anchor position as a side effect — correct for player-initiated moves, wrong for every other caller (walk-to-enemy, leash-return, loot-return). PR #11 split anchor updates into a separate `setCharacterAnchor()` method. Lesson: if only 1 of 5 callers needs a side effect, it doesn't belong in the shared method.

---

## Next Steps / Backlog

### Priority 1: Deferred Refactors
From PR #10 (enemy refactoring):
- Extract `CombatTargetingService` to break forwardRef chain
- Simplify mock `setAttackTarget` to plain stub

### Priority 2: Infrastructure / Polish
- Tighten movement rate limit with real player data (currently 50ms / 20 cmd/sec)
- Separate position persistence from game loop thread if tick spikes appear
- Integration tests for critical paths (join → move → combat → disconnect → rejoin)

---

## Environment Variables

Copy `backend/.env.example` (or create `backend/.env`) with at minimum:

```env
JWT_SECRET=<strong-random-secret>
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=<your-db-user>
DB_PASSWORD=<your-db-password>
DB_NAME=idle_mmo
NODE_ENV=development
```

`JWT_SECRET` **must** be set in production — the app throws at startup if it is missing when `NODE_ENV=production`.

---

## GitHub Workflow

### MCP Setup (one-time, per machine)
To give Claude Code direct GitHub access (post PR comments, reply to reviews, etc.):

```bash
claude mcp add --transport http github --scope user https://api.githubcopilot.com/mcp/
```

This uses your existing `gh` CLI credentials — no separate token needed. Verify with:

```bash
claude mcp list
```

Restart Claude Code after adding the MCP server.

### Branch → PR flow
```bash
git checkout -b <branch-name>
# ... make changes ...
git push -u origin <branch-name>
gh pr create --title "..." --body "..."
```

### Pushing after credential issues
If `git push` returns 403, the macOS keychain may have stale credentials:

```bash
git credential-osxkeychain erase <<'EOF'
protocol=https
host=github.com
EOF
```

Then push again — Git will prompt for your username and a Personal Access Token (not your password). Create a PAT at https://github.com/settings/tokens with `repo` scope.

Alternatively, switch to SSH to avoid HTTPS credential issues entirely:

```bash
git remote set-url origin git@github.com:<org>/<repo>.git
```
