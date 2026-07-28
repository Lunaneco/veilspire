import { CASTLE_PLATEAU, LAKE } from '../world/Terrain.js';
import { RUINS, VILLAGE } from '../world/Settlements.js';
import { CAVERN } from '../world/Cavern.js';
import { BOSS_ARENA } from '../combat/Boss.js';

// North-up overview of the part of the valley used by the main story.
// The terrain continues beyond these bounds, so positions outside the story
// area are clamped to the rim instead of disappearing from the map.
const MAP_MIN = -330;
const MAP_MAX = 330;
const MAP_RANGE = MAP_MAX - MAP_MIN;

const LANDMARKS = [
  { label: 'ACADEMY', short: 'A', x: CASTLE_PLATEAU.x, z: CASTLE_PLATEAU.z },
  { label: 'MIREFALL', short: 'M', x: VILLAGE.x, z: VILLAGE.z },
  { label: 'SUNKEN RING', short: 'R', x: RUINS.x, z: RUINS.z },
  { label: 'CRYSTAL CAVERN', short: 'C', x: CAVERN.x, z: CAVERN.z },
  { label: 'WARDEN', short: 'W', x: BOSS_ARENA.x, z: BOSS_ARENA.z },
];

function mapPercent(value) {
  return Math.max(2.5, Math.min(97.5, ((value - MAP_MIN) / MAP_RANGE) * 100));
}

function setMapPosition(el, x, z) {
  el.style.left = `${mapPercent(x)}%`;
  el.style.top = `${mapPercent(z)}%`;
}

export function playerMarkerRotation(facing) {
  // CSS rotation is clockwise, while the player's yaw increases from south
  // toward east in world space. Mirror the yaw so east points right and west
  // points left on this north-up map.
  return 180 - (facing * 180) / Math.PI;
}

export class Minimap {
  constructor(container, {
    player, worldState, quests, npcs, enemies, boss, caches, collectibles, cavern,
  }) {
    this.player = player;
    this.worldState = worldState;
    this.quests = quests;
    this.npcs = npcs;
    this.enemies = enemies;
    this.boss = boss;
    this.caches = caches;
    this.collectibles = collectibles;
    this.cavern = cavern;
    this._objectiveTimer = 0;
    this._worldMarkerTimer = 0;
    this._objectiveKey = '';
    this._worldMarkers = new Map();

    const el = document.createElement('section');
    el.id = 'minimap';
    el.setAttribute('aria-label', 'Valley map');
    el.innerHTML = `
      <style>
        #minimap {
          position: absolute;
          top: 78px;
          right: 28px;
          width: 190px;
          color: #e8f0fa;
          font-family: Georgia, serif;
          pointer-events: none;
          user-select: none;
          filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.48));
        }
        #minimap .map-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 0 5px 6px;
          color: rgba(225, 235, 250, 0.82);
          font-size: 10px;
          letter-spacing: 2.4px;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
        }
        #minimap .map-head .north {
          color: #d2ad63;
          letter-spacing: 1px;
        }
        #minimap .map-surface {
          position: relative;
          width: 190px;
          height: 190px;
          overflow: hidden;
          border-radius: 50%;
          border: 1px solid rgba(206, 222, 240, 0.48);
          background:
            radial-gradient(circle at 51% 34%, rgba(95, 121, 88, 0.34), transparent 27%),
            radial-gradient(circle at 72% 70%, rgba(49, 100, 115, 0.30), transparent 30%),
            linear-gradient(145deg, rgba(26, 38, 49, 0.94), rgba(8, 14, 24, 0.94));
          box-shadow:
            inset 0 0 0 5px rgba(6, 12, 20, 0.42),
            inset 0 0 36px rgba(0, 0, 0, 0.46),
            0 0 0 1px rgba(8, 12, 20, 0.72);
        }
        #minimap .map-art {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0.78;
        }
        #minimap .map-grid {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background-image:
            linear-gradient(rgba(190, 210, 230, 0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(190, 210, 230, 0.055) 1px, transparent 1px);
          background-size: 25% 25%;
        }
        #minimap .landmark {
          position: absolute;
          width: 15px;
          height: 15px;
          transform: translate(-50%, -50%);
          border: 1px solid rgba(210, 220, 230, 0.34);
          border-radius: 50%;
          background: rgba(11, 18, 28, 0.80);
          color: rgba(220, 230, 240, 0.72);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 8px;
          line-height: 15px;
          text-align: center;
        }
        #minimap .player-marker {
          position: absolute;
          z-index: 4;
          width: 18px;
          height: 22px;
          transform: translate(-50%, -50%) rotate(var(--player-rotation, 0deg));
          transform-origin: 50% 50%;
          filter: drop-shadow(0 0 6px rgba(110, 206, 255, 0.95));
          transition: left 0.06s linear, top 0.06s linear;
        }
        #minimap .player-marker::before {
          content: '';
          position: absolute;
          inset: 0;
          clip-path: polygon(50% 0, 94% 92%, 50% 72%, 6% 92%);
          background: #9fdcff;
          border-radius: 3px;
        }
        #minimap .player-marker::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 44%;
          width: 4px;
          height: 4px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: #effaff;
        }
        #minimap .objective-marker {
          position: absolute;
          z-index: 3;
          width: 17px;
          height: 17px;
          transform: translate(-50%, -50%) rotate(45deg);
          border: 2px solid #f0ca78;
          border-radius: 3px 3px 9px 3px;
          background: rgba(63, 43, 12, 0.78);
          box-shadow: 0 0 0 3px rgba(210, 173, 99, 0.16), 0 0 14px rgba(240, 202, 120, 0.78);
          animation: objective-pulse 1.8s ease-in-out infinite;
        }
        #minimap .world-marker {
          position: absolute;
          z-index: 2;
          transform: translate(-50%, -50%);
          box-sizing: border-box;
        }
        #minimap .side-marker {
          width: 12px;
          height: 12px;
          transform: translate(-50%, -50%) rotate(45deg);
          border: 2px solid #bca4ff;
          background: rgba(70, 48, 118, 0.48);
          box-shadow: 0 0 8px rgba(188, 164, 255, 0.65);
        }
        #minimap .treasure-marker {
          width: 7px;
          height: 7px;
          transform: translate(-50%, -50%) rotate(45deg);
          border: 1px solid #d9fbff;
          background: #63d8e8;
          box-shadow: 0 0 7px rgba(99, 216, 232, 0.92);
        }
        #minimap .enemy-marker {
          width: 7px;
          height: 7px;
          border: 1px solid #ffd0c8;
          border-radius: 50%;
          background: #ef6b58;
          box-shadow: 0 0 7px rgba(239, 107, 88, 0.88);
        }
        #minimap .enemy-marker.boss {
          width: 11px;
          height: 11px;
          border-width: 2px;
          background: #b92f25;
          box-shadow: 0 0 11px rgba(239, 82, 64, 0.98);
        }
        #minimap .objective-marker::after {
          content: '';
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          background: #fff1bf;
        }
        @keyframes objective-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(210, 173, 99, 0.12), 0 0 10px rgba(240, 202, 120, 0.58); }
          50% { box-shadow: 0 0 0 7px rgba(210, 173, 99, 0.03), 0 0 18px rgba(240, 202, 120, 0.94); }
        }
        #minimap .map-foot {
          margin-top: 7px;
          padding: 7px 10px 8px;
          border: 1px solid rgba(190, 210, 235, 0.26);
          border-radius: 8px;
          background: rgba(8, 12, 22, 0.70);
          line-height: 1.25;
        }
        #minimap .objective-kicker {
          color: #d2ad63;
          font-size: 8px;
          letter-spacing: 2px;
          margin-bottom: 3px;
        }
        #minimap .objective-name {
          overflow: hidden;
          color: #eef3f9;
          font-size: 11px;
          letter-spacing: 0.45px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #minimap .objective-distance {
          color: rgba(190, 214, 235, 0.78);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 9px;
          letter-spacing: 1px;
          margin-top: 3px;
        }
        #minimap.complete .objective-kicker { color: #8ae4c0; }
        #minimap.complete .objective-distance { display: none; }
        #minimap .map-legend {
          display: grid;
          grid-template-columns: repeat(3, max-content);
          justify-content: center;
          gap: 5px 10px;
          margin-top: 7px;
          color: rgba(220, 230, 240, 0.76);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 7.5px;
          letter-spacing: 0.7px;
        }
        #minimap .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }
        #minimap .legend-swatch {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--swatch);
          box-shadow: 0 0 5px color-mix(in srgb, var(--swatch) 75%, transparent);
        }
        #minimap .legend-item.side .legend-swatch,
        #minimap .legend-item.treasure .legend-swatch {
          border-radius: 1px;
          transform: rotate(45deg);
        }
        @media (max-width: 780px), (max-height: 620px) {
          #minimap { top: 72px; right: 18px; width: 150px; }
          #minimap .map-surface { width: 150px; height: 150px; }
          #minimap .landmark { transform: translate(-50%, -50%) scale(0.86); }
        }
      </style>
      <div class="map-head"><span>VALLEY MAP</span><span class="north">N ↑</span></div>
      <div class="map-surface">
        <svg class="map-art" viewBox="0 0 200 200" aria-hidden="true">
          <path d="M111 199 C126 170 130 147 143 128 C154 112 175 103 199 101 L199 199 Z"
            fill="rgba(35, 93, 116, 0.42)" stroke="rgba(115, 183, 205, 0.34)" stroke-width="1.2"/>
          <ellipse cx="164" cy="146" rx="31" ry="35"
            fill="rgba(35, 93, 116, 0.32)" stroke="rgba(115, 183, 205, 0.22)" stroke-width="1"/>
          <path d="M108 121 C104 106 101 92 102 78 C103 65 99 54 99 42"
            fill="none" stroke="rgba(191, 165, 112, 0.36)" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M95 40 L102 31 L109 40 M92 43 L102 35 L112 43"
            fill="none" stroke="rgba(210, 220, 230, 0.26)" stroke-width="1.2"/>
          <path d="M20 36 Q49 15 77 26 M122 26 Q159 12 187 44 M12 88 Q28 61 51 63"
            fill="none" stroke="rgba(157, 181, 162, 0.18)" stroke-width="8" stroke-linecap="round"/>
        </svg>
        <div class="map-grid"></div>
        <div class="landmarks"></div>
        <div class="world-markers"></div>
        <div class="objective-marker" aria-hidden="true"></div>
        <div class="player-marker" aria-hidden="true"></div>
      </div>
      <div class="map-foot" aria-live="polite">
        <div class="objective-kicker">MAIN OBJECTIVE</div>
        <div class="objective-name"></div>
        <div class="objective-distance"></div>
      </div>
      <div class="map-legend" aria-label="Map marker legend">
        <span class="legend-item"><i class="legend-swatch" style="--swatch:#9fdcff"></i>YOU</span>
        <span class="legend-item"><i class="legend-swatch" style="--swatch:#f0ca78"></i>MAIN</span>
        <span class="legend-item side"><i class="legend-swatch" style="--swatch:#bca4ff"></i>SIDE</span>
        <span class="legend-item treasure"><i class="legend-swatch" style="--swatch:#63d8e8"></i>TREASURE</span>
        <span class="legend-item"><i class="legend-swatch" style="--swatch:#ef6b58"></i>ENEMY</span>
      </div>
    `;
    container.appendChild(el);

    this.el = el;
    this.playerMarker = el.querySelector('.player-marker');
    this.objectiveMarker = el.querySelector('.objective-marker');
    this.objectiveKicker = el.querySelector('.objective-kicker');
    this.objectiveName = el.querySelector('.objective-name');
    this.objectiveDistance = el.querySelector('.objective-distance');
    this.worldMarkersEl = el.querySelector('.world-markers');

    const landmarksEl = el.querySelector('.landmarks');
    for (const landmark of LANDMARKS) {
      const marker = document.createElement('div');
      marker.className = 'landmark';
      marker.textContent = landmark.short;
      marker.title = landmark.label;
      marker.setAttribute('aria-label', landmark.label);
      setMapPosition(marker, landmark.x, landmark.z);
      landmarksEl.appendChild(marker);
    }
    this._syncWorldMarkers();
  }

  update(dt = 1 / 60) {
    const { x, z } = this.player.position;
    setMapPosition(this.playerMarker, x, z);
    const rotation = playerMarkerRotation(this.player.facing);
    this.playerMarker.style.setProperty('--player-rotation', `${rotation.toFixed(1)}deg`);

    this._worldMarkerTimer -= dt;
    if (this._worldMarkerTimer <= 0) {
      this._worldMarkerTimer = 0.24;
      this._syncWorldMarkers();
    }

    this._objectiveTimer -= dt;
    if (this._objectiveTimer > 0) return;
    this._objectiveTimer = 0.12;

    const objective = this._mainObjective();
    if (!objective) {
      this.objectiveMarker.style.display = 'none';
      this.el.classList.add('complete');
      this.objectiveKicker.textContent = 'MAIN STORY';
      this.objectiveName.textContent = 'Complete';
      this._objectiveKey = 'complete';
      return;
    }

    this.el.classList.remove('complete');
    this.objectiveKicker.textContent = 'MAIN OBJECTIVE';
    this.objectiveMarker.style.display = 'block';
    setMapPosition(this.objectiveMarker, objective.x, objective.z);
    this.objectiveName.textContent = objective.label;
    this.objectiveDistance.textContent =
      `${Math.round(Math.hypot(objective.x - x, objective.z - z))} m`;
    this.objectiveMarker.title = objective.label;
    this._objectiveKey = objective.key;
  }

  _syncWorldMarkers() {
    const markers = [
      { key: 'side-mirefall', kind: 'side', label: 'Side event · Mirefall', ...VILLAGE },
      { key: 'side-cavern', kind: 'side', label: 'Side event · Crystal Cavern', ...CAVERN },
    ];

    for (const cache of this.caches?.caches ?? []) {
      markers.push({
        key: `treasure-cache-${cache.id}`,
        kind: 'treasure',
        label: 'Treasure cache',
        x: cache.pos.x,
        z: cache.pos.z,
      });
    }
    if (this.cavern && !this.cavern.looted) {
      markers.push({
        key: 'treasure-cavern-chest',
        kind: 'treasure',
        label: 'Warded chest',
        x: this.cavern.chestPos.x,
        z: this.cavern.chestPos.z,
      });
    }
    for (const shard of this.collectibles?.shards ?? []) {
      markers.push({
        key: `treasure-shard-${shard.uuid}`,
        kind: 'treasure',
        label: 'Aether shard',
        x: shard.position.x,
        z: shard.position.z,
      });
    }
    for (const enemy of this.enemies?.enemies ?? []) {
      if (enemy.dead || enemy.removed) continue;
      markers.push({
        key: `enemy-${enemy.group?.uuid ?? `${enemy.position.x}:${enemy.position.z}`}`,
        kind: 'enemy',
        boss: !!enemy.isBoss,
        label: enemy.isBoss ? 'The Hollow Warden'
          : enemy.isGolem ? 'Stone golem' : 'Wisp fiend',
        x: enemy.position.x,
        z: enemy.position.z,
      });
    }
    for (const npc of this.npcs?.npcs ?? []) {
      if (npc.dead || npc.removed || npc.mood !== 'hostile') continue;
      markers.push({
        key: `enemy-npc-${npc.model?.root?.uuid ?? `${npc.position.x}:${npc.position.z}`}`,
        kind: 'enemy',
        label: `Hostile · ${npc.displayName}`,
        x: npc.position.x,
        z: npc.position.z,
      });
    }

    const visible = new Set();
    for (const item of markers) {
      visible.add(item.key);
      let marker = this._worldMarkers.get(item.key);
      if (!marker) {
        marker = document.createElement('div');
        this.worldMarkersEl.appendChild(marker);
        this._worldMarkers.set(item.key, marker);
      }
      marker.className = `world-marker ${item.kind}-marker${item.boss ? ' boss' : ''}`;
      marker.title = item.label;
      marker.setAttribute('aria-label', item.label);
      setMapPosition(marker, item.x, item.z);
    }
    for (const [key, marker] of this._worldMarkers) {
      if (visible.has(key)) continue;
      marker.remove();
      this._worldMarkers.delete(key);
    }
  }

  _professor(label, key) {
    const p = this.npcs.professor;
    if (!p || p.dead) return null;
    return { label, key, x: p.position.x, z: p.position.z };
  }

  _mainObjective() {
    const ws = this.worldState;
    const quest = this.quests;

    if (!ws.has('questAccepted')) {
      return this._professor('Meet Professor Maelis', 'meet-maelis');
    }

    if (quest.state === 'active') {
      let closest = null;
      let bestDistance = Infinity;
      for (const enemy of this.enemies.enemies) {
        if (enemy.dead || enemy.removed || enemy.isGolem || enemy.isBoss) continue;
        const distance = enemy.position.distanceToSquared(this.player.position);
        if (distance < bestDistance) {
          closest = enemy;
          bestDistance = distance;
        }
      }
      if (closest) {
        return {
          label: `Cull the wisps · ${quest.kills}/${quest.required}`,
          key: `cull-${quest.kills}`,
          x: closest.position.x,
          z: closest.position.z,
        };
      }
    }

    if (!ws.has('questDone')) {
      return this._professor('Return to Professor Maelis', 'cull-return');
    }
    if (!ws.has('ringQuest')) {
      return this._professor('Ask about the old ring', 'ring-offer');
    }
    if (!ws.has('ringAwakened')) {
      return { label: 'Awaken the Sunken Ring', key: 'ring', x: RUINS.x, z: RUINS.z };
    }
    if (!ws.has('ringReported')) {
      return this._professor('Report the awakened ring', 'ring-return');
    }
    if (!ws.has('bossFelled')) {
      return {
        label: 'Face the Hollow Warden',
        key: 'warden',
        x: BOSS_ARENA.x,
        z: BOSS_ARENA.z,
      };
    }
    if (!ws.has('wardenReported')) {
      return this._professor('Report the Warden’s fall', 'warden-return');
    }
    return null;
  }
}
