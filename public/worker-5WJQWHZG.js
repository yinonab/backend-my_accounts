self.onmessage=function(s){s.data==="start"&&setInterval(()=>{self.postMessage("ping")},25e3)};
