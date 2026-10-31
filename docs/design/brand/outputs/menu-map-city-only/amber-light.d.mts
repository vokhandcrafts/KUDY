export const amberPalette:{core:string;glow:string;edge:string;veil:string};
export interface AmberTiming{chargeMs:number;crestMs:number;revealMs:number;settleMs:number}
export function amberMotion(elapsed:number,timing:AmberTiming):{progress:number;light:number;veil:number;radius:number;phase:'charging'|'crest'|'revealing'|'settling'|'complete'};
export function lightThreads(progress:number,intensity:number):{d:string;opacity:number;width:number;x:number;y:number;offset:number;core:string}[];
