export interface MagnetGroup<Id extends string> { dx:number; dy:number; members:Set<Id> }
export interface MagnetJoint<Id extends string> { a:Id; b:Id; port:readonly number[]; gap:number }
export function findMagnet<Id extends string,G extends MagnetGroup<Id>>(group:G,actors:ReadonlyMap<Id,{group:G}>,joints:readonly MagnetJoint<Id>[],threshold:number):{other:G;joint:MagnetJoint<Id>;delta:number}|undefined;
export function joinGroups<Id extends string,G extends MagnetGroup<Id>>(group:G,other:G,actors:ReadonlyMap<Id,{group:G}>,groups:Set<G>):void;
