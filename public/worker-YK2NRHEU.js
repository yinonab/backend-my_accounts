self.onmessage=function(e){e.data==="start"&&(setInterval(()=>{console.log("\u{1F4E1} Worker sending ping..."),self.postMessage("ping")},25e3),setInterval(()=>{console.log("\u{1F4E1} Worker sending wake-up message..."),self.postMessage("wake-up")},6e4))};
