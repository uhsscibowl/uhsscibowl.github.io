/* Shared by the dashboard and the organizer's publishing dialog. */
const Tournament = (() => {
  const subjects = { Math: "M", Physics: "P", Chemistry: "C", Biology: "B", Earth: "E", Space: "S" };
  const grades = ["6", "7", "8", "9", "10", "11", "12", "unc"];

  function csv(input) {
    const rows = [];
    let row = [], field = "", state = "start";
    const finish = () => {
      row.push(field.trim());
      field = "";
      state = "start";
    };
    const source = input.replace(/^\uFEFF/, "");
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (state === "quoted") {
        if (char !== '"') field += char;
        else if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else state = "closed";
      } else if (char === ",") finish();
      else if (char === "\r" || char === "\n") {
        if (char === "\r" && source[i + 1] === "\n") i++;
        finish();
        rows.push(row);
        row = [];
      } else if (char === '"' && state === "start") state = "quoted";
      else if (char === '"' || state === "closed") throw new Error("Malformed CSV quoting");
      else {
        field += char;
        state = "plain";
      }
    }
    if (state === "quoted") throw new Error("Unclosed CSV field");
    if (row.length || field || state === "closed") {
      finish();
      rows.push(row);
    }
    return rows;
  }

  function readStatic(input) {
    const rows = csv(input);
    const first = rows.findIndex(row => row.some(Boolean));
    if (first < 0 || !rows.slice(first + 1).some(row => row.some(Boolean))) return null;
    const headers = rows[first];
    const index = key => {
      const column = headers.indexOf(key);
      if (column < 0 || column !== headers.lastIndexOf(key)) throw new Error("Invalid Static header: " + key);
      return column;
    };
    const data = rows.slice(first + 1);
    const values = key => data.map(row => row[index(key)] || "");
    const unique = key => {
      const list = values(key).filter(Boolean);
      if (new Set(list).size !== list.length) throw new Error("Duplicate " + key);
      return list;
    };
    const teams = unique("Teams").sort((a, b) => a.localeCompare(b, "en"));
    const schools = unique("Schools");
    if (new Set(teams.map(team => Array.from(team)[0].toUpperCase())).size !== teams.length) {
      throw new Error("Team initials must be unique");
    }
    const rooms = new Map();
    const descriptions = values("Description");
    unique("Room");
    values("Room").forEach((room, i) => { if (room) rooms.set(room, descriptions[i]); });

    const warnings = [];
    const rounds = [];
    const times = values("Start Time");
    values("#").forEach((number, i) => {
      if (!number && !times[i]) return;
      const n = Number(number);
      if (!/^\d+$/.test(number) || !Number.isSafeInteger(n) || n < 1 || rounds.some(round => round.number === n)) {
        warnings.push("Invalid or duplicate round on Static row " + (first + i + 2));
        return;
      }
      if (!times[i]) warnings.push("Missing start time for round " + n);
      rounds.push({ number: n, time: times[i] });
    });
    rounds.sort((a, b) => a.number - b.number);
    if (rounds.some((round, i) => round.number !== i + 1)) warnings.push("Round numbers are not consecutive");

    const [people, levels, affiliations, assignments, strengths] =
      ["Name", "Grade", "School", "Assignment", "Subjects"].map(values);
    const roster = [];
    people.forEach((name, i) => {
      const line = first + i + 2;
      const grade = levels[i].toLowerCase(), school = affiliations[i], assignment = assignments[i];
      const best = [...new Set(strengths[i].split(",").map(value => value.trim()).filter(Boolean))];
      if (!name && !grade && !school && !assignment && !best.length) return;
      if (!name || !grades.includes(grade) || !schools.includes(school)) {
        throw new Error("Invalid person or school on Static row " + line);
      }
      if (best.length > 3 || best.some(subject => !Object.hasOwn(subjects, subject))) {
        throw new Error("Invalid subjects on Static row " + line);
      }
      const room = /^\[(.+)\]$/.exec(assignment)?.[1];
      if ((room && !rooms.has(room)) || (assignment && !room && !teams.includes(assignment))) {
        throw new Error("Unknown assignment on Static row " + line);
      }
      roster.push({ id: i, name, grade, school, assignment, room, best });
    });
    if (!roster.length) return null;
    if (teams.some(team => !roster.some(person => person.assignment === team))) throw new Error("Empty team in Static");
    return { teams, schools, rooms, rounds, roster, warnings };
  }

  // Minimum-cost assignment for a rectangular table, with at least as many columns as rows.
  function allocate(cost) {
    if (!cost.length) return [];
    const rows = cost.length, columns = cost[0].length;
    const rowCost = Array(rows + 1).fill(0), columnCost = Array(columns + 1).fill(0);
    const owner = Array(columns + 1).fill(0), previous = Array(columns + 1).fill(0);
    for (let row = 1; row <= rows; row++) {
      owner[0] = row;
      let current = 0;
      const slack = Array(columns + 1).fill(Infinity), used = Array(columns + 1).fill(false);
      do {
        used[current] = true;
        const active = owner[current];
        let next = 0, delta = Infinity;
        for (let col = 1; col <= columns; col++) {
          if (used[col]) continue;
          const reduced = cost[active - 1][col - 1] - rowCost[active] - columnCost[col];
          if (reduced < slack[col]) {
            slack[col] = reduced;
            previous[col] = current;
          }
          if (slack[col] < delta) {
            delta = slack[col];
            next = col;
          }
        }
        for (let col = 0; col <= columns; col++) {
          if (used[col]) {
            rowCost[owner[col]] += delta;
            columnCost[col] -= delta;
          } else slack[col] -= delta;
        }
        current = next;
      } while (owner[current]);
      do {
        const prior = previous[current];
        owner[current] = owner[prior];
        current = prior;
      } while (current);
    }
    const result = [];
    owner.slice(1).forEach((row, col) => { if (row) result[row - 1] = col; });
    return result;
  }

  function schedule({ teams, rooms, rounds }) {
    const rotation = [...teams];
    if (rotation.length % 2) rotation.push(null);
    const previousRoom = new Map();
    const slots = [...rooms.keys()];
    while (slots.length < Math.floor(teams.length / 2)) slots.push(null);
    return rounds.slice(0, Math.max(0, rotation.length - 1)).map((round, turn) => {
      const pairs = [], byes = [];
      for (let i = 0; i < rotation.length / 2; i++) {
        const a = rotation[i], b = rotation[rotation.length - 1 - i];
        if (a && b) pairs.push([a, b].sort((x, y) => teams.indexOf(x) - teams.indexOf(y)));
        else byes.push(a || b);
      }
      const repeatWeight = pairs.length * slots.length + 1;
      const allocation = allocate(pairs.map((pair, i) => slots.map((room, slot) => {
        const repeats = room ? pair.filter(team => previousRoom.get(team) === room).length : 0;
        const offset = (slot - (i + turn * 2) % slots.length + slots.length) % slots.length;
        return repeats * repeatWeight + offset + (room ? 0 : repeatWeight * 3);
      })));
      previousRoom.clear();
      const games = pairs.map(([a, b], i) => {
        const room = slots[allocation[i]];
        previousRoom.set(a, room);
        previousRoom.set(b, room);
        return { a, b, room, round: round.number };
      });
      rotation.splice(1, 0, rotation.pop());
      return { ...round, byes, games };
    });
  }

  const pairKey = (a, b) => JSON.stringify([a, b].sort());
  const scheduleKey = (data, rounds) => JSON.stringify([data.teams, [...data.rooms.keys()],
    rounds.map(round => [round.number, round.byes, round.games])]);
  const scoreHeader = ["#", "Team A", "Score", "Team B", "Score", "Room"];
  const csvRow = row => row.map(value => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",");
  const scoreTemplate = rounds => [scoreHeader, ...rounds.flatMap(round =>
    round.games.map(game => [round.number, game.a, "", game.b, "", game.room || "TBD"]))].map(csvRow).join("\n") + "\n";

  function readScores(input, rounds) {
    const rows = csv(input);
    const first = rows.findIndex(row => row.some(Boolean));
    const results = new Map(), errors = [], seen = new Set();
    const games = new Map(rounds.flatMap(round => round.games).map(game => [pairKey(game.a, game.b), game]));
    if (first < 0) return { results, errors };
    if (JSON.stringify(rows[first]) !== JSON.stringify(scoreHeader)) {
      return { results, errors: ["Invalid Scores header"] };
    }
    rows.slice(first + 1).forEach((row, i) => {
      if (!row.some(Boolean)) return;
      const line = first + i + 2;
      const [number, a, aScore, b, bScore, room] = row;
      if (row.length === 6 && row.slice(1).every(value => !value) && /^\d+$/.test(number)) return;
      const key = pairKey(a, b), game = games.get(key);
      if (row.length !== 6 || !game || String(game.round) !== number || (game.room || "TBD") !== room) {
        errors.push("Schedule mismatch on Scores row " + line);
      } else if (seen.has(key)) {
        results.delete(key);
        errors.push("Duplicate game on Scores row " + line);
      } else {
        seen.add(key);
        if (!aScore && !bScore) return;
        const valid = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
        if (!valid(aScore) || !valid(bScore)) {
          errors.push("Invalid or partial score on Scores row " + line);
          return;
        }
        results.set(key, {
          a: game.a, b: game.b,
          aScore: Number(a === game.a ? aScore : bScore),
          bScore: Number(a === game.a ? bScore : aScore)
        });
      }
    });
    return { results, errors };
  }

  // Only fully finished rounds (every room scored) count; a half-finished round is ignored.
  // Points = (own scores) + 200 per win + 100 per tie + 100 per bye
  //        + average of opponents' scores in those games.
  function standings(teams, allResults, rounds) {
    const totals = new Map(teams.map(team => [team, 0]));
    const add = (team, value) => totals.set(team, totals.get(team) + value);
    const winner = result => result.aScore === result.bScore ? null : result.aScore > result.bScore ? result.a : result.b;
    const results = new Map(), against = new Map(teams.map(team => [team, []]));
    for (const round of rounds) {
      const played = round.games.map(game => allResults.get(pairKey(game.a, game.b)));
      if (!played.length || played.some(result => !result)) continue;
      round.byes.forEach(team => add(team, 100));
      for (const result of played) {
        results.set(pairKey(result.a, result.b), result);
        const win = winner(result);
        add(result.a, result.aScore + (win === result.a ? 200 : win ? 0 : 100));
        add(result.b, result.bScore + (win === result.b ? 200 : win ? 0 : 100));
        against.get(result.a).push(result.bScore);
        against.get(result.b).push(result.aScore);
      }
    }
    for (const [team, scores] of against) {
      if (scores.length) add(team, scores.reduce((sum, value) => sum + value, 0) / scores.length);
    }
    for (const [team, total] of totals) totals.set(team, Math.round(total * 10) / 10);
    // Head-to-head orders two-way ties. Multi-way ties use head-to-head wins within the group.
    const ordered = [...teams].sort((a, b) => totals.get(b) - totals.get(a));
    const ranks = new Map();
    for (let start = 0; start < ordered.length;) {
      let end = start + 1;
      while (end < ordered.length && totals.get(ordered[end]) === totals.get(ordered[start])) end++;
      const tied = ordered.slice(start, end), wins = new Map(tied.map(team => [team, 0]));
      for (let a = 0; a < tied.length; a++) {
        for (let b = a + 1; b < tied.length; b++) {
          const result = results.get(pairKey(tied[a], tied[b]));
          const win = result && winner(result);
          if (win) wins.set(win, wins.get(win) + 1);
        }
      }
      tied.sort((a, b) => wins.get(b) - wins.get(a) || teams.indexOf(a) - teams.indexOf(b));
      tied.forEach((team, i) => ranks.set(team, start + i + 1));
      start = end;
    }
    return { totals, ranks };
  }

  return { csv, readStatic, schedule, scheduleKey, readScores, scoreTemplate, standings, pairKey, subjects, grades };
})();
