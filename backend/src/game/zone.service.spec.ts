import { Test, TestingModule } from '@nestjs/testing';
import { ZoneService } from './zone.service';
import { PlayerStateStore } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { NestStateStore } from './stores/nest-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { SpellQueueStore } from './stores/spell-queue.store';

describe('ZoneService', () => {
  let service: ZoneService;
  let mockPlayerStateStore: Partial<PlayerStateStore>;
  let mockEnemyStateStore: Partial<EnemyStateStore>;
  let mockNestStateStore: Partial<NestStateStore>;
  let mockDroppedItemStore: Partial<DroppedItemStore>;
  let mockSpellQueueStore: Partial<SpellQueueStore>;

  beforeEach(async () => {
    mockPlayerStateStore = { ensureZone: jest.fn() };
    mockEnemyStateStore = { ensureZone: jest.fn() };
    mockNestStateStore = { ensureZone: jest.fn() };
    mockDroppedItemStore = { ensureZone: jest.fn() };
    mockSpellQueueStore = { ensureZone: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneService,
        { provide: PlayerStateStore, useValue: mockPlayerStateStore },
        { provide: EnemyStateStore, useValue: mockEnemyStateStore },
        { provide: NestStateStore, useValue: mockNestStateStore },
        { provide: DroppedItemStore, useValue: mockDroppedItemStore },
        { provide: SpellQueueStore, useValue: mockSpellQueueStore },
      ],
    }).compile();

    service = module.get<ZoneService>(ZoneService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create startZone on initialization', () => {
    expect(mockPlayerStateStore.ensureZone).toHaveBeenCalledWith('startZone');
    expect(mockEnemyStateStore.ensureZone).toHaveBeenCalledWith('startZone');
    expect(mockNestStateStore.ensureZone).toHaveBeenCalledWith('startZone');
    expect(mockDroppedItemStore.ensureZone).toHaveBeenCalledWith('startZone');
    expect(mockSpellQueueStore.ensureZone).toHaveBeenCalledWith('startZone');
    expect(service.getActiveZoneIds()).toContain('startZone');
  });

  it('should create a new zone and initialize all stores', () => {
    service.createZone('testZone');
    expect(mockPlayerStateStore.ensureZone).toHaveBeenCalledWith('testZone');
    expect(mockEnemyStateStore.ensureZone).toHaveBeenCalledWith('testZone');
    expect(mockNestStateStore.ensureZone).toHaveBeenCalledWith('testZone');
    expect(mockDroppedItemStore.ensureZone).toHaveBeenCalledWith('testZone');
    expect(mockSpellQueueStore.ensureZone).toHaveBeenCalledWith('testZone');
    expect(service.getActiveZoneIds()).toContain('testZone');
  });

  it('should not re-create an existing zone', () => {
    service.createZone('testZone');
    const callCount = (mockPlayerStateStore.ensureZone as jest.Mock).mock.calls.length;
    service.createZone('testZone');
    // Should not have called ensureZone again for testZone
    expect((mockPlayerStateStore.ensureZone as jest.Mock).mock.calls.length).toBe(callCount);
  });

  it('should return all active zone IDs', () => {
    service.createZone('zone2');
    service.createZone('zone3');
    const ids = service.getActiveZoneIds();
    expect(ids).toContain('startZone');
    expect(ids).toContain('zone2');
    expect(ids).toContain('zone3');
    expect(ids.length).toBe(3);
  });
});
