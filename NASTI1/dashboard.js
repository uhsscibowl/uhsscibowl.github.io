(() => {
  const main = document.querySelector("#dashboard");
  const header = document.querySelector("#header");
  const dialog = document.querySelector("#details");
  const title = document.querySelector("#dialog-title");
  const body = document.querySelector("#dialog-body");
  const keyName = "nasti1-key", identityName = "nasti1-identity";
  let data, rounds, person, key, batch, expires, score, games, refresh, expiryTimer;
  let loading = false, generation = 0;
  let roundIndex = 0, showingRankings = false, collapsed = false;

  function el(tag, value, className) {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function button(label, action, description, className) {
    const node = el("button", label, className);
    node.type = "button";
    if (description) node.setAttribute("aria-label", description);
    node.addEventListener("click", action);
    return node;
  }

  function logo(size) {
    const brand = el("span", undefined, "logo");
    const image = el("img");
    image.src = "../favicon.svg";
    image.alt = "";
    image.width = image.height = size;
    brand.append(image, el("b", "NASTI 1"));
    return brand;
  }

  function gate(message) {
    header.hidden = true;
    if (dialog.open) dialog.close();
    const status = el("p", message);
    status.role = "status";
    const section = el("section", undefined, "gate");
    section.append(logo(96), status);
    main.replaceChildren(section);
    main.setAttribute("aria-busy", "false");
  }

  function forget() {
    generation++;
    localStorage.removeItem(identityName);
    localStorage.removeItem(keyName);
    key = person = data = rounds = score = games = batch = expires = undefined;
    clearInterval(refresh);
    clearTimeout(expiryTimer);
  }

  function checkExpiry() {
    if (!expires) return;
    clearTimeout(expiryTimer);
    const remaining = expires - Date.now();
    if (remaining > 0) {
      expiryTimer = setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
      return;
    }
    forget();
    gate("Tournament access expired");
  }

  async function fetchCSV(kind) {
    const response = await fetch(kind + ".csv", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load " + kind + ".csv");
    return response.text();
  }

  const identity = entry => JSON.stringify([entry.id, entry.name, entry.grade, entry.school]);

  async function load() {
    if (loading) return;
    loading = true;
    const session = generation;
    try {
      const roster = await fetchCSV("static");
      if (session !== generation) return;
      if (!roster.trim().startsWith("{")) {
        forget();
        gate("Not available yet");
        return;
      }
      const secret = localStorage.getItem(keyName);
      if (!secret) {
        gate("Access key required · Scan the tournament QR code");
        return;
      }
      let decoded;
      try {
        const imported = key || await TournamentCrypto.importKey(secret);
        decoded = await TournamentCrypto.open(imported, roster, "static");
        if (session !== generation) return;
        key = imported;
      } catch {
        if (session !== generation) return;
        forget();
        gate("Incorrect access key or damaged roster");
        return;
      }
      if (decoded.expires <= Date.now()) {
        forget();
        gate("Tournament access expired");
        return;
      }
      expires = decoded.expires;
      checkExpiry();
      const nextData = batch === decoded.batch ? data : Tournament.readStatic(decoded.csv);
      if (!nextData) {
        forget();
        gate("Not available yet");
        return;
      }
      const nextRounds = batch === decoded.batch ? rounds : Tournament.schedule(nextData);
      const scores = await TournamentCrypto.open(key, await fetchCSV("scores"), "scores");
      if (session !== generation) return;
      if (scores.batch !== decoded.batch || scores.expires !== expires || scores.schedule !== decoded.schedule) {
        throw new Error("Tournament update in progress");
      }
      const nextScore = Tournament.readScores(scores.csv, nextRounds);
      if (batch === decoded.batch && JSON.stringify([...nextScore.results]) === JSON.stringify([...score.results]) &&
          JSON.stringify(nextScore.errors) === JSON.stringify(score.errors) && !main.querySelector(".gate")) {
        const issues = main.querySelector(".issues");
        if (issues) issues.textContent = [...data.warnings, ...score.errors].join(" · ");
        return;
      }

      batch = decoded.batch;
      data = nextData;
      rounds = nextRounds;
      score = nextScore;
      games = new Map(rounds.flatMap(round => round.games).map(game => [Tournament.pairKey(game.a, game.b), game]));
      if (dialog.open) dialog.close();
      if (person) {
        person = data.roster.find(entry => identity(entry) === identity(person));
        roundIndex = Math.min(roundIndex, Math.max(0, rounds.length - 1));
      } else {
        const stored = localStorage.getItem(identityName);
        person = data.roster.find(entry => identity(entry) === stored);
        if (person) setInitialRound();
      }
      if (person) render();
      else login();
    } catch (error) {
      if (session !== generation) return;
      if (expires && expires <= Date.now()) {
        forget();
        gate("Tournament access expired");
      } else if (person && !main.querySelector(".gate")) {
        main.querySelector(".issues").textContent = error.message;
      } else gate(error.message);
    } finally {
      loading = false;
      main.setAttribute("aria-busy", "false");
    }
  }

  function inputSelect(name, values) {
    const select = el("select");
    select.name = name;
    const placeholder = el("option", name);
    placeholder.value = "";
    placeholder.selected = true;
    select.append(placeholder, ...values.map(value => el("option", value)));
    return select;
  }

  const normalize = value => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

  function distance(a, b) {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const row = [i + 1];
      for (let j = 0; j < b.length; j++) {
        row.push(Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + Number(a[i] !== b[j])));
      }
      previous = row;
    }
    return previous[b.length];
  }

  function login() {
    header.hidden = true;
    const section = el("section", undefined, "login card");
    const form = el("form");
    const name = el("input");
    name.name = "Name";
    name.autocomplete = "off";
    name.maxLength = 100;
    name.placeholder = "Name";
    const grade = inputSelect("Grade", Tournament.grades), school = inputSelect("School", data.schools);
    const output = el("div", undefined, "search-results");
    output.setAttribute("aria-live", "polite");
    for (const input of [name, grade, school]) {
      const label = el("label", input.name);
      label.append(input);
      form.append(label);
      input.addEventListener("input", search);
    }
    form.addEventListener("submit", event => event.preventDefault());

    function search() {
      const query = normalize(name.value);
      output.replaceChildren();
      if (!query && !grade.value && !school.value) return;
      const max = Math.min(3, Math.max(1, Math.floor(query.length / 4)));
      const matches = data.roster
        .filter(entry => (!grade.value || entry.grade === grade.value) &&
          (!school.value || entry.school === school.value))
        .map(entry => {
          const candidate = normalize(entry.name);
          return { entry, distance: !query || candidate.startsWith(query) ? 0 : distance(query, candidate) };
        })
        .filter(match => match.distance <= max)
        .sort((a, b) => a.distance - b.distance || a.entry.name.localeCompare(b.entry.name, "en"));
      if (!matches.length) output.append(el("p", "No person found"));
      for (const { entry } of matches) {
        const row = el("div", undefined, "candidate");
        row.append(personLabel(entry), el("small", entry.assignment || "Unassigned"),
          button("→", () => {
            person = entry;
            localStorage.setItem(identityName, identity(entry));
            setInitialRound();
            render();
            header.querySelector(".brand").focus();
          }, "Open schedule for " + entry.name + ", " + (entry.assignment || "Unassigned"), "icon"));
        output.append(row);
      }
    }
    section.append(logo(64), el("h1", "Find your schedule"), form, output);
    main.replaceChildren(section);
  }

  function personLabel(entry, role) {
    const wrapper = el("span", undefined, "person");
    wrapper.append(el("strong", entry.name), el("span", entry.grade, "pill"), el("span", entry.school, "pill"));
    if (role) wrapper.append(el("span", role, "pill role"));
    for (const subject of entry.best) {
      const wrap = el("span", undefined, "subject-wrap");
      const tip = el("span", subject, "subject-tip");
      tip.setAttribute("aria-hidden", "true");
      let timeout;
      const pill = button(Tournament.subjects[subject], () => {
        document.querySelectorAll(".subject-wrap[data-tapped]").forEach(item => item.removeAttribute("data-tapped"));
        wrap.dataset.tapped = "";
        clearTimeout(timeout);
        timeout = setTimeout(() => wrap.removeAttribute("data-tapped"), 5000);
      }, subject, "pill subject");
      wrap.append(pill, tip);
      wrapper.append(wrap);
    }
    return wrapper;
  }

  const teamMembers = team => data.roster.filter(entry => entry.assignment === team);
  const moderators = room => room ? data.roster.filter(entry => entry.room === room) : [];

  function peopleList(entries) {
    const list = el("ul", undefined, "people");
    for (const entry of entries) {
      const item = el("li");
      item.append(personLabel(entry));
      list.append(item);
    }
    return list;
  }

  function teamBlock(team) {
    const block = el("section", undefined, "team");
    block.append(el("h3", team), peopleList(teamMembers(team)));
    return block;
  }

  function roomBlock(room) {
    const block = el("section", undefined, "room");
    block.append(el("h3", room ? "Room " + room : "Room TBD"));
    if (data.rooms.get(room)) block.append(el("p", data.rooms.get(room)));
    const mods = moderators(room);
    if (mods.length) block.append(peopleList(mods));
    return block;
  }

  function showDetails(heading, ...children) {
    title.textContent = heading;
    body.replaceChildren(...children);
    dialog.showModal();
  }

  function myGame(round) {
    return round.games.find(game => person.room ? game.room === person.room :
      [game.a, game.b].includes(person.assignment));
  }

  function setInitialRound() {
    const unplayed = rounds.findIndex(round => {
      const game = myGame(round);
      return game && !score.results.has(Tournament.pairKey(game.a, game.b));
    });
    roundIndex = Math.max(0, unplayed);
  }

  function renderSchedule(target, focus) {
    target.replaceChildren();
    const round = rounds[roundIndex];
    if (!round) {
      target.append(el("h2", "No scheduled rounds"));
      return;
    }
    const nav = el("div", undefined, "round-nav");
    const move = (index, selector) => {
      if (index < 0 || index >= rounds.length || index === roundIndex) return;
      roundIndex = index;
      renderSchedule(target, selector);
    };
    const previous = button("‹", () => move(roundIndex - 1, ".previous"), "Previous round", "icon previous");
    const next = button("›", () => move(roundIndex + 1, ".next"), "Next round", "icon next");
    previous.disabled = roundIndex === 0;
    next.disabled = roundIndex === rounds.length - 1;
    nav.append(previous, el("h2", "Round " + round.number), next);
    const dots = el("div", undefined, "round-dots");
    rounds.forEach((item, i) => {
      const dot = button("●", () => move(i, '[aria-current="step"]'), "Round " + item.number);
      if (i === roundIndex) dot.setAttribute("aria-current", "step");
      dots.append(dot);
    });
    target.append(nav, dots);
    if (round.time) target.append(el("p", round.time, "round-time"));
    const game = myGame(round);
    if (!game) {
      target.append(el("p", round.byes.includes(person.assignment) ? "Bye" : "No match"));
    } else {
      const teams = person.room ? [game.a, game.b] : [game.a === person.assignment ? game.b : game.a];
      const result = score.results.get(Tournament.pairKey(game.a, game.b));
      if (result) target.append(el("p", game.a + " " + result.aScore + " – " + result.bScore + " " + game.b, "scoreline"));
      target.append(...teams.map(teamBlock), roomBlock(game.room));
    }
    let start;
    target.ontouchstart = event => { start = event.touches.length === 1 ? event.touches[0] : undefined; };
    target.ontouchcancel = () => { start = undefined; };
    target.ontouchend = event => {
      if (!start) return;
      const end = event.changedTouches[0], x = end.clientX - start.clientX, y = end.clientY - start.clientY;
      if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(y) * 1.5) move(roundIndex + (x < 0 ? 1 : -1));
      start = undefined;
    };
    if (focus) (target.querySelector(focus + ":not(:disabled)") || dots.querySelector('[aria-current="step"]')).focus();
  }

  function renderRankings() {
    const section = el("section", undefined, "card rankings");
    section.append(el("h1", "Rankings"));
    const wrapper = el("div", undefined, "matrix-scroll");
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Results matrix");
    const table = el("table"), head = table.createTHead().insertRow();
    const add = (row, tag, value, scope) => {
      const cell = el(tag);
      if (typeof value === "string") cell.textContent = value;
      else cell.append(value);
      if (scope) cell.scope = scope;
      row.append(cell);
      return cell;
    };
    const teamButton = team => button(Array.from(team)[0].toUpperCase(),
      () => showDetails(team, peopleList(teamMembers(team))), team);
    add(head, "th", "", "col");
    data.teams.forEach(team => add(head, "th", teamButton(team), "col"));
    add(head, "th", "Rank", "col");
    add(head, "th", "Points", "col");

    const { totals, ranks } = Tournament.standings(data.teams, score.results);
    const rows = table.createTBody();
    for (const a of data.teams) {
      const row = rows.insertRow();
      add(row, "th", teamButton(a), "row");
      for (const b of data.teams) {
        const id = Tournament.pairKey(a, b), game = games.get(id), result = score.results.get(id);
        const cell = add(row, "td", "");
        if (!game) {
          cell.className = "inactive";
          cell.setAttribute("aria-label", "No match");
          continue;
        }
        const rowScore = result && (a === result.a ? result.aScore : result.bScore);
        const colScore = result && (b === result.a ? result.aScore : result.bScore);
        const mark = !result ? "" : rowScore === colScore ? "=" : rowScore > colScore ? "←" : "↑";
        const label = a + " versus " + b + ", " + (!result ? "unplayed" :
          rowScore === colScore ? "draw" : (rowScore > colScore ? a : b) + " won");
        cell.append(button(mark, () => {
          showDetails(a + " vs " + b, el("p", result ? rowScore + " – " + colScore : "Unplayed", "scoreline"),
            el("p", "Round " + game.round), roomBlock(game.room), teamBlock(a), teamBlock(b));
        }, label, mark === "←" ? "row-win" : mark === "↑" ? "column-win" : ""));
      }
      add(row, "td", String(ranks.get(a)));
      add(row, "td", String(totals.get(a)));
    }
    wrapper.append(table);
    section.append(wrapper);
    main.append(section);
  }

  function render() {
    header.hidden = false;
    const brand = el("a", undefined, "brand");
    brand.href = "../";
    brand.append(logo(32));
    const who = el("div", undefined, "current-person");
    who.append(personLabel(person, person.room ? "mod" : "player"));
    const actions = el("div", undefined, "actions");
    actions.append(button(showingRankings ? "🕒" : "🎉", () => {
      showingRankings = !showingRankings;
      render();
      header.querySelector(".actions button").focus();
    }, showingRankings ? "Schedule" : "Rankings", "icon"), button("→", () => {
      localStorage.removeItem(identityName);
      person = undefined;
      showingRankings = collapsed = false;
      login();
      main.querySelector("input").focus();
    }, "Sign out", "icon"));
    header.replaceChildren(brand, who, actions);
    const issues = el("div", [...data.warnings, ...score.errors].join(" · "), "issues");
    issues.setAttribute("role", "status");
    main.replaceChildren(issues);
    if (showingRankings) {
      renderRankings();
      return;
    }
    const roster = el("details", undefined, "card roster");
    roster.open = !collapsed;
    roster.addEventListener("toggle", () => { collapsed = !roster.open; });
    roster.append(el("summary", person.room ? "Room " + person.room : person.assignment || "Unassigned"));
    if (person.room) {
      if (data.rooms.get(person.room)) roster.append(el("p", data.rooms.get(person.room)));
      roster.append(peopleList(moderators(person.room)));
    } else if (person.assignment) roster.append(peopleList(teamMembers(person.assignment)));
    else roster.append(el("p", "Contact a moderator if your assignment is missing."));
    main.append(roster);
    if (person.assignment) {
      const schedule = el("section", undefined, "card schedule");
      main.append(schedule);
      renderSchedule(schedule);
    }
  }

  let startedOutside = false;
  const outsideDialog = event => {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  dialog.addEventListener("pointerdown", event => { startedOutside = outsideDialog(event); });
  dialog.addEventListener("click", event => {
    if (startedOutside && outsideDialog(event)) dialog.close();
    startedOutside = false;
  });

  try {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("key")) {
      localStorage.removeItem(identityName);
      localStorage.setItem(keyName, params.get("key"));
      history.replaceState(null, "", location.pathname + location.search);
    }
    load();
    refresh = setInterval(load, 60_000);
    document.addEventListener("visibilitychange", checkExpiry);
  } catch (error) {
    gate(error.message);
  }
})();
