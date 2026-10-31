import { nativeLayout } from '../native-layout.ts';
import { findMagnet, joinGroups } from '../magnet.mjs';
import { amberMotion } from '../amber-light.mjs';

export type PieceId = typeof nativeLayout.pieces[number]['id'];
export type SceneId = typeof nativeLayout.layers[number]['id'];
export type Point = { x: number; y: number };
export type Phase = 'scattered' | 'assembling' | 'charging' | 'crest' | 'revealing' | 'settling' | 'complete';
type Group = { dx: number; dy: number; members: Set<PieceId> };
type Shape = { id: string; x: number; y: number; width: number; height: number; rows: number[][] };
type Piece = Shape & { id: PieceId; group: Group };
type Hit = { id: PieceId; passive: false } | { id: SceneId; passive: true };
type Gesture = { hit: Hit; start: Point; last: Point; at: number; group?: Group; original?: Point; held: boolean; cancelled: boolean };
export type PuzzleEvent = { kind: 'none' } | { kind: 'select'; id: PieceId } | { kind: 'passive'; id: SceneId; point: Point } | { kind: 'snap'; point: Point; complete: boolean };

const rows = (value: string) => value.split(';').map(row => row ? row.split(',').map(Number) : []);
const contains = (shape: Shape, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= shape.width || y >= shape.height) return false;
  const row = shape.rows[Math.floor(y)];
  for (let i = 0; i < row.length; i += 2) if (x >= row[i] && x < row[i + 1]) return true;
  return false;
};
const none: PuzzleEvent = { kind: 'none' };

export class CityPuzzle {
  readonly pieces = new Map<PieceId, Piece>();
  readonly groups = new Set<Group>();
  readonly scenery = nativeLayout.layers.map(item => ({ ...item, rows: rows(item.hitRows) }));
  phase: Phase = 'scattered';
  light = 0;
  silhouette = 0;
  radius = 0;
  effectProgress = 0;
  active: Gesture | null = null;
  private motion: { at: number; group: Group; from: Point } | null = null;
  private scale: number;

  constructor(width: number, random: () => number = Math.random) {
    this.scale = this.validScale(width);
    const slots = [[170,190],[880,230],[1010,880],[130,850],[410,1400]];
    nativeLayout.pieces.forEach((item, index) => {
      const [x,y] = slots[index];
      const group = { dx: x + random()*22 - 125 - item.x, dy: y + random()*16 - 320 - item.y, members: new Set([item.id]) };
      this.groups.add(group);
      this.pieces.set(item.id, { ...item, rows: rows(item.hitRows), group });
    });
  }
  private validScale(width: number) {
    if (!Number.isFinite(width) || width <= 0) throw new RangeError('CityMapMenu width must be positive and finite');
    return width / 1600;
  }
  resize(width: number) { this.cancel(); this.scale = this.validScale(width); }
  position(id: PieceId): Point {
    const piece = this.pieces.get(id)!;
    return { x: 125 + piece.x + piece.group.dx, y: 320 + piece.y + piece.group.dy };
  }
  hit(point: Point): Hit | undefined {
    for (const piece of [...this.pieces.values()].reverse()) {
      const at = this.position(piece.id);
      if (contains(piece, point.x-at.x, point.y-at.y)) return { id: piece.id, passive: false };
    }
    if (this.phase === 'scattered') for (const piece of this.pieces.values()) {
      const at = this.position(piece.id), labelWidth = Math.max(350, Math.min(650, piece.width+80));
      if (Math.abs(point.x-at.x-piece.width/2) < labelWidth/2 && point.y < at.y && point.y > at.y-48/this.scale) return { id: piece.id, passive: false };
    }
    const x = point.x-125, y = point.y-320;
    if (Math.hypot(x-675,y-582) <= this.radius && this.radius > 0) for (const part of this.scenery) {
      if (contains(part,x-part.x,y-part.y)) return { id: part.id, passive: true };
    }
  }
  begin(point: Point, now: number): Hit | undefined {
    this.cancel();
    const hit = this.hit(point);
    if (!hit) return;
    const group = hit.passive ? undefined : this.pieces.get(hit.id)!.group;
    this.active = { hit, group, start: point, last: point, at: now, original: group ? {x:group.dx,y:group.dy} : undefined, held: false, cancelled: false };
    return hit;
  }
  hold(now: number) {
    const active = this.active;
    if (active && !active.hit.passive && !active.cancelled && this.phase === 'scattered' && now-active.at >= nativeLayout.gesture.holdMs) active.held = true;
  }
  move(point: Point, now: number): PuzzleEvent {
    const active = this.active;
    if (!active || active.cancelled) return none;
    this.hold(now);
    if (!active.held) {
      if (Math.hypot(point.x-active.start.x,point.y-active.start.y)*this.scale > nativeLayout.gesture.tapSlopDp) active.cancelled = true;
      return none;
    }
    const group = active.group!;
    const dx = point.x-active.last.x, dy = point.y-active.last.y;
    if (dx === 0 && dy === 0) return none;
    const members = [...group.members].map(id => this.pieces.get(id)!);
    group.dx = Math.max(-Math.min(...members.map(p=>p.x))-55,Math.min(1390-Math.max(...members.map(p=>p.x+p.width)),group.dx+dx));
    group.dy = Math.max(-Math.min(...members.map(p=>p.y))-130,Math.min(1370-Math.max(...members.map(p=>p.y+p.height)),group.dy+dy));
    active.last = point;
    const target = findMagnet(group,this.pieces,nativeLayout.joints,nativeLayout.gesture.snapDistanceDp/this.scale);
    if (!target) return none;
    joinGroups(group,target.other,this.pieces,this.groups);
    this.active = null;
    const complete = group.members.size === 5;
    if (complete) { this.motion = { at: now, group, from: {x:group.dx,y:group.dy} }; this.phase = 'assembling'; }
    return { kind:'snap', complete, point:{x:125+group.dx+target.joint.port[0],y:320+group.dy+target.joint.port[1]} };
  }
  release(now: number): PuzzleEvent {
    const active = this.active;
    this.active = null;
    if (!active || active.cancelled || active.held || now-active.at >= nativeLayout.gesture.holdMs) return none;
    return active.hit.passive ? {kind:'passive',id:active.hit.id,point:active.start} : {kind:'select',id:active.hit.id};
  }
  cancel() {
    if (this.active?.group && this.active.original) { this.active.group.dx=this.active.original.x; this.active.group.dy=this.active.original.y; }
    this.active = null;
  }
  advance(now: number): boolean {
    if (!this.motion) return false;
    const {at,group,from} = this.motion;
    const elapsed = Math.max(0,now-at),center = Math.min(1,elapsed/400);
    group.dx=from.x*(1-center)**3; group.dy=from.y*(1-center)**3;
    const t=elapsed-400,{chargeMs,crestMs,revealMs,settleMs}=nativeLayout.reveal;
    this.phase=t<0?'assembling':t<chargeMs?'charging':t<chargeMs+crestMs?'crest':t<chargeMs+crestMs+revealMs?'revealing':'settling';
    const effect=amberMotion(t,nativeLayout.reveal);
    this.light=effect.light;this.silhouette=effect.veil;this.radius=effect.radius;this.effectProgress=effect.progress;
    if(t>=chargeMs+crestMs+revealMs+settleMs)this.completeNow();
    return this.motion !== null;
  }
  completeNow() {
    if (this.groups.size !== 1) return;
    const group = [...this.groups][0];
    if (group.members.size !== 5) return;
    group.dx=0;group.dy=0;this.motion=null;this.phase='complete';this.radius=1000;this.light=0;this.silhouette=0;this.effectProgress=1;this.active=null;
  }
}
