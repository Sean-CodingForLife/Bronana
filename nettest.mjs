const t = setTimeout(()=>{console.log("TIMEOUT");process.exit(0)}, 25000);
fetch("https://store.steampowered.com/api/appdetails?appids=606150&l=english")
 .then(r=>r.text()).then(x=>{clearTimeout(t);console.log("OK", x.length, x.slice(0,200));})
 .catch(e=>{clearTimeout(t);console.log("ERR", e && e.message);});
