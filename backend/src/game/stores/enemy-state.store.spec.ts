import { Test, TestingModule } from '@nestjs/testing';
import { EnemyStateStore } from './enemy-state.store';
import { NestStateStore } from './nest-state.store';
import { EnemyService } from '../../enemy/enemy.service';
import { SpawnNest } from '../interfaces/spawn-nest.interface';

describe('EnemyStateStore', () => {
  let store: EnemyStateStore;
  let mockEnemyService: Partial<EnemyService>;
  let mockNestStateStore: Partial<NestStateStore>;

  const mockTemplate = {
    id: 'template-1',
    name: 'Goblin',
    baseHealth: 100,
    baseAttack: 10,
    baseDefense: 5,
    baseSpeed: 75,
    lootTableId: null,
    spriteKey: 'goblin',
    level: 1,
    attackRange: 30,
    xpReward: 10,
    behaviorFlags: { isAggressive: true, isStationary: false, canFlee: false },
    createdAt: new Date(),
    updatedAt: new Date(),
    lootTable: null,
  };

  beforeEach(async () => {
    mockEnemyService = {
      findOne: jest.fn().mockResolvedValue(mockTemplate),
    };
    mockNestStateStore = {
      getNest: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnemyStateStore,
        { provide: EnemyService, useValue: mockEnemyService },
        { provide: NestStateStore, useValue: mockNestStateStore },
      ],
    }).compile();

    store = module.get<EnemyStateStore>(EnemyStateStore);
    store.ensureZone('zone1');
  });

  describe('ensureZone', () => {
    it('should create zone if it does not exist', () => {
      store.ensureZone('newZone');
      expect(store.getZoneEnemies('newZone')).toEqual([]);
    });

    it('should not overwrite existing zone', async () => {
      await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      store.ensureZone('zone1');
      expect(store.getEnemyCount('zone1')).toBe(1);
    });
  });

  describe('addEnemy', () => {
    it('should add an enemy with spriteKey from template', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 100, y: 200 });
      expect(enemy).toBeDefined();
      expect(enemy!.spriteKey).toBe('goblin');
      expect(enemy!.name).toBe('Goblin');
      expect(enemy!.currentHealth).toBe(100);
      expect(enemy!.position).toEqual({ x: 100, y: 200 });
    });

    it('should return null for non-existent zone', async () => {
      const enemy = await store.addEnemy('nonexistent', 'template-1', { x: 0, y: 0 });
      expect(enemy).toBeNull();
    });

    it('should return null for non-existent template', async () => {
      (mockEnemyService.findOne as jest.Mock).mockResolvedValueOnce(null);
      const enemy = await store.addEnemy('zone1', 'bad-template', { x: 0, y: 0 });
      expect(enemy).toBeNull();
    });
  });

  describe('addEnemyFromNest', () => {
    it('should add an enemy with spriteKey from nest template', async () => {
      const mockNest: SpawnNest = {
        id: 'nest-1',
        zoneId: 'zone1',
        templateId: 'template-1',
        center: { x: 500, y: 500 },
        radius: 100,
        maxCapacity: 5,
        currentEnemyIds: new Set(),
        respawnDelayMs: 5000,
        lastSpawnCheckTime: 0,
      };

      const enemy = await store.addEnemyFromNest(mockNest);
      expect(enemy).toBeDefined();
      expect(enemy!.spriteKey).toBe('goblin');
      expect(enemy!.nestId).toBe('nest-1');
      expect(mockNest.currentEnemyIds.has(enemy!.id)).toBe(true);
    });

    it('should return null when nest is at capacity', async () => {
      const mockNest: SpawnNest = {
        id: 'nest-1',
        zoneId: 'zone1',
        templateId: 'template-1',
        center: { x: 500, y: 500 },
        radius: 100,
        maxCapacity: 0,
        currentEnemyIds: new Set(),
        respawnDelayMs: 5000,
        lastSpawnCheckTime: 0,
      };
      const enemy = await store.addEnemyFromNest(mockNest);
      expect(enemy).toBeNull();
    });
  });

  describe('removeEnemy', () => {
    it('should remove enemy and return true', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      const result = store.removeEnemy('zone1', enemy!.id);
      expect(result).toBe(true);
      expect(store.getEnemy('zone1', enemy!.id)).toBeUndefined();
    });

    it('should clean up nest reference via NestStateStore', async () => {
      const nestEnemyIds = new Set<string>();
      const mockNest: SpawnNest = {
        id: 'nest-1',
        zoneId: 'zone1',
        templateId: 'template-1',
        center: { x: 500, y: 500 },
        radius: 100,
        maxCapacity: 5,
        currentEnemyIds: nestEnemyIds,
        respawnDelayMs: 5000,
        lastSpawnCheckTime: 0,
      };
      // Configure the mock to return this nest when looked up
      (mockNestStateStore.getNest as jest.Mock).mockReturnValue(mockNest);

      const enemy = await store.addEnemyFromNest(mockNest);
      expect(nestEnemyIds.has(enemy!.id)).toBe(true);

      store.removeEnemy('zone1', enemy!.id);
      expect(mockNestStateStore.getNest).toHaveBeenCalledWith('zone1', 'nest-1');
      expect(nestEnemyIds.has(enemy!.id)).toBe(false);
    });

    it('should return false for non-existent enemy', () => {
      const result = store.removeEnemy('zone1', 'nonexistent');
      expect(result).toBe(false);
    });

    it('should handle stale nestId when nest no longer exists', async () => {
      const mockNest: SpawnNest = {
        id: 'nest-gone',
        zoneId: 'zone1',
        templateId: 'template-1',
        center: { x: 500, y: 500 },
        radius: 100,
        maxCapacity: 5,
        currentEnemyIds: new Set(),
        respawnDelayMs: 5000,
        lastSpawnCheckTime: 0,
      };

      // getNest returns the nest during addEnemyFromNest so the enemy gets a nestId
      (mockNestStateStore.getNest as jest.Mock).mockReturnValue(mockNest);
      const enemy = await store.addEnemyFromNest(mockNest);
      expect(enemy).toBeDefined();
      expect(enemy!.nestId).toBe('nest-gone');

      // Simulate nest being removed — getNest now returns undefined
      (mockNestStateStore.getNest as jest.Mock).mockReturnValue(undefined);

      // removeEnemy should still succeed (not throw) even with a stale nestId
      const result = store.removeEnemy('zone1', enemy!.id);
      expect(result).toBe(true);
      expect(mockNestStateStore.getNest).toHaveBeenCalledWith('zone1', 'nest-gone');
      expect(store.getEnemy('zone1', enemy!.id)).toBeUndefined();
    });
  });

  describe('updateEnemyPosition', () => {
    it('should update position and return true', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      const result = store.updateEnemyPosition('zone1', enemy!.id, { x: 50, y: 75 });
      expect(result).toBe(true);
      expect(store.getEnemy('zone1', enemy!.id)!.position).toEqual({ x: 50, y: 75 });
    });

    it('should return false for non-existent enemy', () => {
      expect(store.updateEnemyPosition('zone1', 'bad', { x: 0, y: 0 })).toBe(false);
    });
  });

  describe('setEnemyTarget', () => {
    it('should set target and return true', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      const result = store.setEnemyTarget('zone1', enemy!.id, { x: 50, y: 50 });
      expect(result).toBe(true);
      expect(store.getEnemy('zone1', enemy!.id)!.target).toEqual({ x: 50, y: 50 });
    });

    it('should set target to null', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      store.setEnemyTarget('zone1', enemy!.id, { x: 50, y: 50 });
      store.setEnemyTarget('zone1', enemy!.id, null);
      expect(store.getEnemy('zone1', enemy!.id)!.target).toBeNull();
    });

    it('should return false for non-existent enemy', () => {
      expect(store.setEnemyTarget('zone1', 'bad', { x: 0, y: 0 })).toBe(false);
    });
  });

  describe('setEnemyAiState', () => {
    it('should set AI state and return true', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      const result = store.setEnemyAiState('zone1', enemy!.id, 'CHASING');
      expect(result).toBe(true);
      expect(store.getEnemy('zone1', enemy!.id)!.aiState).toBe('CHASING');
    });

    it('should return false for non-existent enemy', () => {
      expect(store.setEnemyAiState('zone1', 'bad', 'IDLE')).toBe(false);
    });
  });

  describe('updateEnemyHealth', () => {
    it('should decrease health correctly', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      const newHealth = await store.updateEnemyHealth('zone1', enemy!.id, -30);
      expect(newHealth).toBe(70);
    });

    it('should not go below 0', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      const newHealth = await store.updateEnemyHealth('zone1', enemy!.id, -999);
      expect(newHealth).toBe(0);
    });

    it('should return null for non-existent enemy', async () => {
      const result = await store.updateEnemyHealth('zone1', 'bad', -10);
      expect(result).toBeNull();
    });
  });

  describe('updateEnemyAttackTime', () => {
    it('should update attack time and return true', async () => {
      const enemy = await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      const timestamp = Date.now();
      const result = store.updateEnemyAttackTime('zone1', enemy!.id, timestamp);
      expect(result).toBe(true);
      expect(store.getEnemy('zone1', enemy!.id)!.lastAttackTime).toBe(timestamp);
    });

    it('should return false for non-existent enemy', () => {
      expect(store.updateEnemyAttackTime('zone1', 'bad', Date.now())).toBe(false);
    });
  });

  describe('getEnemyCount', () => {
    it('should return correct count', async () => {
      expect(store.getEnemyCount('zone1')).toBe(0);
      await store.addEnemy('zone1', 'template-1', { x: 0, y: 0 });
      expect(store.getEnemyCount('zone1')).toBe(1);
      await store.addEnemy('zone1', 'template-1', { x: 10, y: 10 });
      expect(store.getEnemyCount('zone1')).toBe(2);
    });
  });
});
