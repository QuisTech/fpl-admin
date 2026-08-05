const https = require('https'); 
https.get('https://fantasy.premierleague.com/api/bootstrap-static/', res => { 
    let data = ''; 
    res.on('data', chunk => data += chunk); 
    res.on('end', () => { 
        const json = JSON.parse(data); 
        const top = json.elements.sort((a,b) => parseFloat(b.now_cost) - parseFloat(a.now_cost)).slice(0,5); 
        console.log(top.map(p => p.web_name + ': ep_next=' + p.ep_next + ', total_points=' + p.total_points)); 
    }); 
});
