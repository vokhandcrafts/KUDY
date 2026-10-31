import React,{useState} from 'react';
import {registerRootComponent} from 'expo';
import {useFonts} from 'expo-font';
import {ScrollView,StyleSheet,Text,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {CityMapMenu} from './CityMapMenu';
import type {PieceId} from './model';
import manifest from '../manifest.json';

function Preview(){
  const {width}=useWindowDimensions();
  const [selected,setSelected]=useState<PieceId|null>(null);
  const [fontsLoaded]=useFonts({Golos:require('../fonts/GolosText.ttf'),Alegreya:require('../fonts/Alegreya.ttf')});
  return <SafeAreaProvider><SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={[styles.brand,fontsLoaded&&{fontFamily:'Golos'}]}>KUDY</Text>
    <Text style={[styles.title,fontsLoaded&&{fontFamily:'Alegreya'}]}>Куды сёння?</Text>
    <CityMapMenu width={Math.min(430,width-32)} labels={manifest.labels.be} sceneLabels={{water:'Вада і масты. Без пераходу.',fortifications:'Астатняя карта. Без пераходу.'}} hint="Націсні, каб адкрыць. Утрымлівай і перацягвай, каб злучыць." labelStyle={fontsLoaded?{fontFamily:'Golos'}:undefined} onSelect={setSelected}/>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{selected?`Выбраны раздзел: ${manifest.labels.be[selected]}`:'Націсні — адкрыць. Утрымлівай і перацягвай — злучыць.'}</Text>
  </ScrollView></SafeAreaView></SafeAreaProvider>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#faf7f2'},content:{padding:16,alignItems:'center'},brand:{alignSelf:'flex-start',fontSize:24,color:'#1d6b4f'},title:{alignSelf:'flex-start',fontSize:34,color:'#22262b',marginTop:16},status:{fontSize:14,color:'#706d63',paddingVertical:20,textAlign:'center'}});
registerRootComponent(Preview);
