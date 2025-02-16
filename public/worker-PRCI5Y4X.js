self.onmessage=function(e){console.log("\u{1F504} worker starter"),e.data==="start"&&setInterval(()=>{console.log("\u{1F4E1} Worker sending ping..."),self.postMessage("ping")},25e3)};
