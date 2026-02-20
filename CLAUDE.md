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

### Known issues
- **Enemy spawns/behaviors are broken** after the ZoneService refactoring. Enemy rendering and AI need a dedicated refactoring pass (planned for next session).

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
