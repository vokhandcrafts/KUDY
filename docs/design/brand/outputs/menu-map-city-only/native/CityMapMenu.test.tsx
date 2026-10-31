import React from 'react';
import {jest,expect,test,afterEach} from '@jest/globals';
import {render,fireEvent,screen,act} from '@testing-library/react-native';
import {processColor} from 'react-native';
import {CityMapMenu} from './CityMapMenu';
import {nativeLayout} from '../native-layout';

const labels={nearby:'Побач',guides:'Гіды',discovery:'Чым заняцца','reserve-1':'Хутка',kudy:'KUDY'};
const props={width:360,labels,hint:'Утрымлівай і перацягвай',sceneLabels:{water:'Вада',fortifications:'Астатняя карта'},reduceMotion:true};
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test('five native accessibility activations call only their stable menu IDs',()=>{
  const select=jest.fn();render(<CityMapMenu {...props} onSelect={select}/>);
  expect(screen.getByTestId('city-menu-veil-guides',{includeHiddenElements:true}).props.fill).toEqual({type:0,payload:processColor('#fff0c8')});
  for(const p of nativeLayout.pieces)fireEvent(screen.getByTestId(`city-menu-access-${p.id}`),'accessibilityTap');
  expect(select.mock.calls.map(call=>call[0])).toEqual(nativeLayout.pieces.map(p=>p.id));
});
test('translations change while the native piece positions remain stable',()=>{
  const {rerender}=render(<CityMapMenu {...props} onSelect={()=>{}}/>);
  const before=screen.getByTestId('city-menu-piece-guides',{includeHiddenElements:true}).props.transform;
  rerender(<CityMapMenu {...props} labels={{...labels,guides:'Stadtführungen durch die Altstadt'}} onSelect={()=>{}}/>);
  expect(screen.getByText('Stadtführungen durch die Altstadt',{includeHiddenElements:true})).toBeTruthy();
  expect(screen.getByTestId('city-menu-piece-guides',{includeHiddenElements:true}).props.transform).toEqual(before);
});
test('native responder tap selects, while early movement cancels selection',()=>{
  jest.spyOn(Math,'random').mockReturnValue(.5);jest.useFakeTimers();
  const select=jest.fn();render(<CityMapMenu {...props} onSelect={select}/>);
  const canvas=screen.getByTestId('city-menu-canvas');
  let stamp=0;
  const event=(x:number,y:number)=>({nativeEvent:{locationX:x,locationY:y,pageX:x,pageY:y,touches:[{pageX:x,pageY:y}],changedTouches:[{pageX:x,pageY:y}]},touchHistory:{numberActiveTouches:1,indexOfSingleActiveTouch:0,mostRecentTimeStamp:++stamp,touchBank:[{touchActive:true,currentTimeStamp:stamp,currentPageX:x,currentPageY:y,previousPageX:x,previousPageY:y}]}});
  const gesture={dx:0,dy:0,numberActiveTouches:1};
  act(()=>{canvas.props.onResponderGrant(event(80,65),gesture);canvas.props.onResponderRelease(event(80,65),gesture);});
  expect(select).toHaveBeenCalledWith('nearby');select.mockClear();
  act(()=>{canvas.props.onResponderGrant(event(80,65),gesture);canvas.props.onResponderMove(event(130,65),gesture);canvas.props.onResponderRelease(event(130,65),gesture);});
  expect(select).not.toHaveBeenCalled();
});
test('real native drags assemble all five, retain five flows and give the scene no flow',()=>{
  jest.spyOn(Math,'random').mockReturnValue(.5);jest.useFakeTimers();
  const select=jest.fn();render(<CityMapMenu {...props} onSelect={select}/>);
  const canvas=screen.getByTestId('city-menu-canvas');let stamp=0;
  const event=(x:number,y:number)=>({nativeEvent:{locationX:x,locationY:y,touches:[{}]},touchHistory:{numberActiveTouches:1,indexOfSingleActiveTouch:0,mostRecentTimeStamp:++stamp,touchBank:[{touchActive:true,currentTimeStamp:stamp,currentPageX:x,currentPageY:y,previousPageX:x,previousPageY:y}]}});
  const gesture={dx:0,dy:0,numberActiveTouches:1};
  const scale=360/1600;
  for(const [sx,sy,tx,ty] of [[1072,397,709,352],[1201,989,909,252],[358,1054,419,632],[579,1520,709,712]]){
    act(()=>canvas.props.onResponderGrant(event(sx*scale,sy*scale),gesture));
    act(()=>jest.advanceTimersByTime(301));
    act(()=>{canvas.props.onResponderMove(event(tx*scale,ty*scale),gesture);canvas.props.onResponderRelease(event(tx*scale,ty*scale),gesture);});
  }
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByTestId('city-menu-scene-water')).toBeTruthy();
  for(const [id,x,y] of [['nearby',330,485],['guides',650,520],['discovery',850,420],['reserve-1',360,800],['kudy',650,880]] as const){
    act(()=>{canvas.props.onResponderGrant(event((125+x)*scale,(320+y)*scale),gesture);canvas.props.onResponderRelease(event((125+x)*scale,(320+y)*scale),gesture);});
    expect(select).toHaveBeenLastCalledWith(id);
  }
  select.mockClear();
  act(()=>{canvas.props.onResponderGrant(event(775*scale,530*scale),gesture);canvas.props.onResponderRelease(event(775*scale,530*scale),gesture);});
  fireEvent(screen.getByTestId('city-menu-scene-water'),'accessibilityTap');
  expect(select).not.toHaveBeenCalled();
});
