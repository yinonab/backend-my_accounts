import{d as s,g as e,j as t,k as o}from"./chunk-EZ2AII26.js";var n,d=s(()=>{o();n=class extends t{constructor(){super(),this.handleVisibilityChange=()=>{let i={isActive:document.hidden!==!0};this.notifyListeners("appStateChange",i),document.hidden?this.notifyListeners("pause",null):this.notifyListeners("resume",null)},document.addEventListener("visibilitychange",this.handleVisibilityChange,!1)}exitApp(){throw this.unimplemented("Not implemented on web.")}getInfo(){return e(this,null,function*(){throw this.unimplemented("Not implemented on web.")})}getLaunchUrl(){return e(this,null,function*(){return{url:""}})}getState(){return e(this,null,function*(){return{isActive:document.hidden!==!0}})}minimizeApp(){return e(this,null,function*(){throw this.unimplemented("Not implemented on web.")})}}});d();export{n as AppWeb};
