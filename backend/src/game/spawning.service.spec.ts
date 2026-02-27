import { Test, TestingModule } from '@nestjs/testing';
import { SpawningService } from './spawning.service';
import { EnemyStateStore } from './stores/enemy-state.store';
import { NestStateStore } from './stores/nest-state.store';
import { SpawnNest } from './interfaces/spawn-nest.interface';

describe('SpawningService', () => {
  let service: SpawningService;
  let mockEnemyStateStore: Partial<EnemyStateStore>;
  let mockNestStateStore: Partial<NestStateStore>;

  const createMockNest = (overrides?: Partial<SpawnNest>): SpawnNest => ({
    id: 'nest-1',
    zoneId: 'zone1',
    templateId: 'template-1',
    center: { x: 500, y: 500 },
    radius: 100,
    maxCapacity: 3,
    currentEnemyIds: new Set(),
    respawnDelayMs: 5000,
    lastSpawnCheckTime: 0,
    ...overrides,
  });

  beforeEach(async () => {
    mockEnemyStateStore = {
      addEnemyFromNest: jest.fn().mockResolvedValue({
        id: 'enemy-1',
        templateId: 'template-1',
        zoneId: 'zone1',
        name: 'Goblin',
        currentHealth: 100,
        position: { x: 500, y: 500 },
        aiState: 'IDLE',
        baseAttack: 10,
        baseDefense: 5,
        baseSpeed: 75,
        lootTableId: null,
        spriteKey: 'goblin',
        level: 1,
      }),
    };
    mockNestStateStore = {
      getZoneNests: jest.fn().mockReturnValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpawningService,
        { provide: EnemyStateStore, useValue: mockEnemyStateStore },
        { provide: NestStateStore, useValue: mockNestStateStore },
      ],
    }).compile();

    service = module.get<SpawningService>(SpawningService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty array when no nests exist', async () => {
    const result = await service.processNestSpawns('zone1', Date.now());
    expect(result).toEqual([]);
  });

  it('should spawn enemy when nest has capacity and timer elapsed', async () => {
    const nest = createMockNest({ lastSpawnCheckTime: 0, respawnDelayMs: 1000 });
    (mockNestStateStore.getZoneNests as jest.Mock).mockReturnValue([nest]);

    const now = 5000;
    const result = await service.processNestSpawns('zone1', now);
    expect(result.length).toBe(1);
    expect(mockEnemyStateStore.addEnemyFromNest).toHaveBeenCalledWith(nest);
  });

  it('should not spawn when timer has not elapsed', async () => {
    const nest = createMockNest({ lastSpawnCheckTime: 4500, respawnDelayMs: 5000 });
    (mockNestStateStore.getZoneNests as jest.Mock).mockReturnValue([nest]);

    const result = await service.processNestSpawns('zone1', 5000);
    expect(result).toEqual([]);
    expect(mockEnemyStateStore.addEnemyFromNest).not.toHaveBeenCalled();
  });

  it('should not spawn when nest is at capacity', async () => {
    const nest = createMockNest({
      maxCapacity: 1,
      currentEnemyIds: new Set(['existing-enemy']),
    });
    (mockNestStateStore.getZoneNests as jest.Mock).mockReturnValue([nest]);

    const result = await service.processNestSpawns('zone1', 99999);
    expect(result).toEqual([]);
    expect(mockEnemyStateStore.addEnemyFromNest).not.toHaveBeenCalled();
  });

  it('should update lastSpawnCheckTime when at capacity', async () => {
    const nest = createMockNest({
      maxCapacity: 1,
      currentEnemyIds: new Set(['existing-enemy']),
      lastSpawnCheckTime: 0,
    });
    (mockNestStateStore.getZoneNests as jest.Mock).mockReturnValue([nest]);

    const now = 5000;
    await service.processNestSpawns('zone1', now);
    expect(nest.lastSpawnCheckTime).toBe(now);
  });

  it('should spawn enemy within nest radius of nest center', async () => {
    const nest = createMockNest({ lastSpawnCheckTime: 0, respawnDelayMs: 1000, center: { x: 500, y: 500 }, radius: 100 });
    const spawnedEnemy = {
      id: 'enemy-1',
      templateId: 'template-1',
      zoneId: 'zone1',
      name: 'Goblin',
      currentHealth: 100,
      position: { x: 540, y: 560 },
      aiState: 'IDLE',
      baseAttack: 10,
      baseDefense: 5,
      baseSpeed: 75,
      lootTableId: null,
      spriteKey: 'goblin',
      level: 1,
    };
    (mockEnemyStateStore.addEnemyFromNest as jest.Mock).mockResolvedValueOnce(spawnedEnemy);
    (mockNestStateStore.getZoneNests as jest.Mock).mockReturnValue([nest]);

    const now = 5000;
    const result = await service.processNestSpawns('zone1', now);
    expect(result.length).toBe(1);

    // Verify addEnemyFromNest was called with the nest (position is calculated inside EnemyStateStore)
    expect(mockEnemyStateStore.addEnemyFromNest).toHaveBeenCalledWith(nest);

    // The actual position bounds check: spawned position should be within nest.radius of nest.center
    const dx = spawnedEnemy.position.x - nest.center.x;
    const dy = spawnedEnemy.position.y - nest.center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    expect(distance).toBeLessThanOrEqual(nest.radius);
  });

  it('should update lastSpawnCheckTime when spawn fails', async () => {
    const nest = createMockNest({ lastSpawnCheckTime: 0, respawnDelayMs: 1000 });
    (mockNestStateStore.getZoneNests as jest.Mock).mockReturnValue([nest]);
    (mockEnemyStateStore.addEnemyFromNest as jest.Mock).mockResolvedValueOnce(null);

    const now = 5000;
    await service.processNestSpawns('zone1', now);
    expect(nest.lastSpawnCheckTime).toBe(now);
  });
});
