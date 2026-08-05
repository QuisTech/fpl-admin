async function checkFPL() {
  const response = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
  const data = await response.json();
  const sorted = data.elements.sort((a, b) => parseFloat(b.ep_next) - parseFloat(a.ep_next));
  console.table(sorted.slice(0, 10).map(p => ({
    Name: p.web_name,
    Team: data.teams.find(t => t.id === p.team).short_name,
    ep_next: p.ep_next,
    ep_this: p.ep_this,
    form: p.form
  })));
}
checkFPL();
