import React, {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,AppState,PanResponder,StyleSheet,Text,View} from 'react-native';
import type {GestureResponderEvent,StyleProp,TextStyle,ViewStyle} from 'react-native';
import Svg,{Circle,ClipPath,Defs,Ellipse,G,Image as SvgImage,Mask,Path,RadialGradient,Rect,Stop} from 'react-native-svg';
import {amberPalette,lightThreads} from '../amber-light.mjs';
import {cityMenuAssets,citySceneAssets} from '../native-assets';
import {nativeLayout} from '../native-layout';
import {CityPuzzle} from './model';
import type {PieceId,Point,PuzzleEvent,SceneId} from './model';

export type {PieceId,SceneId} from './model';
export interface CityMapMenuProps {
  width: number;
  labels: Readonly<Record<PieceId,string>>;
  hint: string;
  sceneLabels: Readonly<Record<SceneId,string>>;
  onSelect: (id:PieceId)=>void;
  reduceMotion?: boolean;
  labelStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}

export function CityMapMenu(props:CityMapMenuProps) {
  const {width,labels,hint,sceneLabels,labelStyle,style}=props;
  const [model]=useState(()=>new CityPuzzle(width));
  const [,setRevision]=useState(0);
  const [systemReduced,setSystemReduced]=useState(true);
  const reduced=props.reduceMotion??systemReduced;
  const latest=useRef(props);latest.current=props;
  const reducedRef=useRef(reduced);reducedRef.current=reduced;
  const frame=useRef<number|null>(null);
  const hold=useRef<ReturnType<typeof setTimeout>|null>(null);
  const feedback=useRef<{point:Point;until:number}|null>(null);
  const clock=useRef(Date.now());
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  const clearHold=useCallback(()=>{if(hold.current!==null)clearTimeout(hold.current);hold.current=null;},[]);
  const stopFrame=useCallback(()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;},[]);
  const cancel=useCallback(()=>{clearHold();model.cancel();refresh();},[clearHold,model,refresh]);
  const startFrame=useCallback(()=>{
    if(frame.current!==null)return;
    const tick=()=>{
      frame.current=null;clock.current=Date.now();
      if(reducedRef.current)model.completeNow();
      const moving=model.advance(clock.current);
      if(feedback.current&&feedback.current.until<=clock.current)feedback.current=null;
      refresh();
      if(moving||feedback.current)frame.current=requestAnimationFrame(tick);
    };
    frame.current=requestAnimationFrame(tick);
  },[model,refresh]);
  const pulse=useCallback((point:Point)=>{
    feedback.current={point,until:Date.now()+(reducedRef.current?120:380)};
    startFrame();refresh();
  },[startFrame,refresh]);
  const handle=useCallback((event:PuzzleEvent)=>{
    if(event.kind==='select')latest.current.onSelect(event.id);
    else if(event.kind==='passive'||event.kind==='snap'){
      pulse(event.point);
      if(event.kind==='snap'&&event.complete){if(reducedRef.current)model.completeNow();else startFrame();}
    }
  },[model,pulse,startFrame]);

  useLayoutEffect(()=>{stopFrame();clearHold();model.resize(width);if(model.phase!=='scattered'&&model.phase!=='complete')model.completeNow();feedback.current=null;refresh();},[width,model,refresh,clearHold,stopFrame]);
  useEffect(()=>{
    if(props.reduceMotion!==undefined)return;
    let active=true;
    AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(active)setSystemReduced(value);}).catch(error=>console.warn('Could not read Reduce Motion; using reduced motion',error));
    const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setSystemReduced);
    return()=>{active=false;listener.remove();};
  },[props.reduceMotion]);
  useEffect(()=>{
    if(reduced){stopFrame();feedback.current=null;model.completeNow();refresh();}
  },[reduced,model,stopFrame,refresh]);
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',state=>{
      if(state!=='active'){clearHold();stopFrame();model.cancel();model.completeNow();feedback.current=null;refresh();}
    });
    return()=>{subscription.remove();clearHold();stopFrame();model.cancel();feedback.current=null;};
  },[model,clearHold,stopFrame,refresh]);

  const responder=useMemo(()=>{
    const point=(event:GestureResponderEvent)=>({x:event.nativeEvent.locationX*1600/width,y:event.nativeEvent.locationY*1600/width});
    return PanResponder.create({
      onStartShouldSetPanResponder:event=>event.nativeEvent.touches.length===1&&Boolean(model.hit(point(event))),
      onPanResponderGrant:event=>{
        clearHold();if(event.nativeEvent.touches.length!==1){cancel();return;}
        const hit=model.begin(point(event),Date.now());refresh();
        if(hit&&!hit.passive)hold.current=setTimeout(()=>{hold.current=null;model.hold(Date.now());refresh();},nativeLayout.gesture.holdMs);
      },
      onPanResponderStart:event=>{if(event.nativeEvent.touches.length!==1)cancel();},
      onPanResponderMove:event=>{
        if(event.nativeEvent.touches.length!==1){cancel();return;}
        const result=model.move(point(event),Date.now());
        if(result.kind==='snap')clearHold();
        handle(result);refresh();
      },
      onPanResponderRelease:()=>{clearHold();const result=model.release(Date.now());refresh();handle(result);},
      onPanResponderTerminate:cancel,
      onPanResponderTerminationRequest:()=>true,
      onShouldBlockNativeResponder:()=>true,
    });
  },[width,model,cancel,clearHold,handle,refresh]);

  const scale=width/1600,complete=model.phase!=='scattered';
  const pulseProgress=feedback.current?Math.max(0,Math.min(1,(feedback.current.until-clock.current)/380)):0;
  const passivePress=(id:SceneId)=>{const part=model.scenery.find(p=>p.id===id)!;pulse({x:125+part.x+part.width/2,y:320+part.y+part.height/2});};
  return <View style={[styles.host,style,{width,height:width*1.125}]}>
    <View testID="city-menu-canvas" collapsable={false} style={StyleSheet.absoluteFill} {...responder.panHandlers}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        <Svg width={width} height={width*1.125} viewBox="0 0 1600 1800">
          <Defs>
            <RadialGradient id="city-menu-light"><Stop offset={0} stopColor={amberPalette.core}/><Stop offset={0.4} stopColor={amberPalette.glow} stopOpacity={0.95}/><Stop offset={1} stopColor={amberPalette.edge} stopOpacity={0}/></RadialGradient>
            <ClipPath id="city-menu-reveal"><Circle cx="675" cy="582" r={model.radius}/></ClipPath>
            {nativeLayout.pieces.map(item=><Mask key={item.id} id={`city-menu-veil-${item.id}`} maskUnits="userSpaceOnUse" x={0} y={0} width={item.width} height={item.height}><SvgImage href={cityMenuAssets[item.id].light} width={item.width} height={item.height}/></Mask>)}
          </Defs>
          <Ellipse cx="800" cy="902" rx={350+model.light*530} ry={320+model.light*470} fill="url(#city-menu-light)" opacity={model.light}/>
          <G opacity={model.light*.25} fill="none" stroke={amberPalette.glow}><Ellipse cx="800" cy="902" rx="690" ry="560" strokeWidth={5}/><Ellipse cx="800" cy="902" rx="740" ry="610" strokeWidth={2}/></G>
          <G testID="city-menu-light-threads" pointerEvents="none" transform="translate(125 320)" opacity={reduced?0:1}>
            {lightThreads(model.effectProgress,model.light).map((thread,i)=><G key={i} transform={`translate(${thread.x} ${thread.y})`} opacity={thread.opacity}>
              <Path d={thread.d} fill="none" stroke={amberPalette.glow} strokeWidth={18} strokeOpacity={0.1} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[1700,1500]} strokeDashoffset={thread.offset}/>
              <Path d={thread.d} fill="none" stroke={amberPalette.edge} strokeWidth={7} strokeOpacity={0.4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[1700,1500]} strokeDashoffset={thread.offset}/>
              <Path d={thread.d} fill="none" stroke={thread.core} strokeWidth={thread.width} strokeOpacity={0.95} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[1700,1500]} strokeDashoffset={thread.offset}/>
            </G>)}
          </G>
          {nativeLayout.pieces.map(item=>{
            const at=model.position(item.id),piece=model.pieces.get(item.id)!,assets=cityMenuAssets[item.id];
            const pressed=model.active?.hit.id===item.id;
            return <G key={item.id} testID={`city-menu-piece-${item.id}`} transform={`translate(${at.x} ${at.y})`} opacity={pressed&&!model.active?.held?0.86:1}>
              <SvgImage href={assets.city} width={item.width} height={item.height}/>
              {!complete&&piece.group.members.size===1&&<SvgImage href={assets.ui} x={-item.padding} y={-item.padding} width={item.width+item.padding*2} height={item.height+item.padding*2}/>}
              <Rect testID={`city-menu-veil-${item.id}`} x={0} y={0} width={item.width} height={item.height} fill={amberPalette.veil} mask={`url(#city-menu-veil-${item.id})`} opacity={model.silhouette}/>
              {!complete&&<><Path d={`M${item.width/2},-45 Q${item.width/2+25},-10 ${item.width/2},10`} stroke={model.active?.held&&pressed?'#bd852c':'#957e60'} strokeWidth={5} fill="none"/><Circle cx={item.width/2} cy={10} r={7} fill="#957e60"/></>}
            </G>;
          })}
          <G transform="translate(125 320)" clipPath="url(#city-menu-reveal)">
            {nativeLayout.layers.map(item=><SvgImage key={item.id} href={citySceneAssets[item.id]} x={item.x} y={item.y} width={item.width} height={item.height}/>)}
          </G>
          {feedback.current&&<Circle cx={feedback.current.point.x} cy={feedback.current.point.y} r={reduced?55:40+(1-pulseProgress)*140} stroke="#bd852c" strokeWidth={6} fill="#f4d68a" fillOpacity={.2} opacity={pulseProgress}/>}
        </Svg>
        {!complete&&nativeLayout.pieces.map(item=>{
          const at=model.position(item.id),labelWidth=Math.max(350,Math.min(650,item.width+80))*scale;
          return <Text key={item.id} numberOfLines={2} ellipsizeMode="tail" style={[styles.label,labelStyle,{left:(at.x+item.width/2)*scale-labelWidth/2,top:at.y*scale-48,width:labelWidth}]}>{labels[item.id]}</Text>;
        })}
      </View>
      {nativeLayout.pieces.map(item=>{
        const at=model.position(item.id),activate=()=>latest.current.onSelect(item.id);
        return <View key={item.id} testID={`city-menu-access-${item.id}`} pointerEvents="none" accessible accessibilityRole="button" accessibilityLabel={labels[item.id]} accessibilityHint={hint} accessibilityActions={[{name:'activate'}]} onAccessibilityTap={activate} onAccessibilityAction={event=>{if(event.nativeEvent.actionName==='activate')activate();}} style={{position:'absolute',left:at.x*scale,top:at.y*scale,width:Math.max(48,item.width*scale),height:Math.max(48,item.height*scale)}}/>;
      })}
      {model.phase==='complete'&&nativeLayout.layers.map(item=><View key={item.id} testID={`city-menu-scene-${item.id}`} pointerEvents="none" accessible accessibilityRole="button" accessibilityLabel={sceneLabels[item.id]} onAccessibilityTap={()=>passivePress(item.id)} accessibilityActions={[{name:'activate'}]} onAccessibilityAction={event=>{if(event.nativeEvent.actionName==='activate')passivePress(item.id);}} style={{position:'absolute',left:(125+item.x)*scale,top:(320+item.y)*scale,width:item.width*scale,height:item.height*scale}}/>)}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  host:{backgroundColor:'#faf7f2',overflow:'hidden'},
  label:{position:'absolute',height:48,fontSize:14,lineHeight:20,color:'#1d6b4f',textAlign:'center',textAlignVertical:'bottom',paddingTop:6},
});
