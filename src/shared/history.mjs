const databaseName = "aditusan-calculation-history";
let database;

function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const records = db.createObjectStore("records", { keyPath: "id", autoIncrement: true });
      records.createIndex("scope", "scope");
      db.createObjectStore("snapshots");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Calculation history storage is blocked."));
  });
  return database;
}

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function changeHistory(scope, update) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["records", "snapshots"], "readwrite");
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error("History storage is unavailable."));
    const records = transaction.objectStore("records");
    const snapshots = transaction.objectStore("snapshots");
    const matches = records.index("scope").getAll(scope);
    matches.onsuccess = () => update(matches.result, records, snapshots);
  });
}

export function createHistory(id, { label = "Restore", action, limit = 20 } = {}) {
  const panel = document.getElementById(id);
  const list = panel.querySelector(".history-list");
  const empty = panel.querySelector(".history-empty");
  const clear = panel.querySelector(".history-clear");
  const note = panel.querySelector(".history-message");
  const scope = location.pathname.replace(/index\.html$/, "").replace(/\/?$/, "/") + "#" + id;
  const byteLimit = 96 * 1024 * 1024;
  let pending = Promise.resolve();
  let temporary;

  function render(entries) {
    list.replaceChildren();
    empty.hidden = entries.length > 0;
    clear.disabled = entries.length === 0;
    for (const entry of entries) {
      const row = document.createElement("li");
      const description = document.createElement("span");
      description.textContent = entry.summary;
      const when = document.createElement("small");
      when.className = "history-time";
      when.textContent = new Date(entry.time).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
      description.append(when);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", label + " " + entry.summary);
      button.addEventListener("click", async () => {
        try {
          const snapshot = entry.id === null
            ? structuredClone(temporary.snapshot)
            : await resultOf((await openDatabase()).transaction("snapshots").objectStore("snapshots").get(entry.id));
          if (!snapshot) throw new Error("That calculation was cleared.");
          await action(snapshot);
        } catch (error) {
          note.textContent = error.message;
        }
      });
      row.append(description, button);
      list.append(row);
    }
  }

  async function refresh() {
    let entries = [];
    try {
      const db = await openDatabase();
      entries = await resultOf(db.transaction("records").objectStore("records").index("scope").getAll(scope));
    } catch {
      note.textContent = "Saved history is unavailable in this browser.";
    }
    entries.reverse();
    if (temporary) entries.unshift(temporary.record);
    render(entries);
  }

  clear.addEventListener("click", () => {
    pending = pending.then(async () => {
      try {
        await changeHistory(scope, (entries, records, snapshots) => {
          for (const entry of entries) {
            records.delete(entry.id);
            snapshots.delete(entry.id);
          }
        });
        temporary = undefined;
        note.textContent = "History cleared.";
      } catch {
        if (temporary) {
          temporary = undefined;
          note.textContent = "Temporary history cleared.";
        } else {
          note.textContent = "The browser could not clear saved history.";
        }
      }
      await refresh();
    });
  });

  pending = refresh();
  return {
    add(summary, snapshot, bytes = 0) {
      const record = { scope, summary, time: Date.now(), bytes };
      pending = pending.then(async () => {
        try {
          await changeHistory(scope, (entries, records, snapshots) => {
            let keep = 1;
            let usedBytes = bytes;
            for (const entry of entries.reverse()) {
              if (keep >= limit || usedBytes + entry.bytes > byteLimit) {
                records.delete(entry.id);
                snapshots.delete(entry.id);
              } else {
                keep++;
                usedBytes += entry.bytes;
              }
            }
            const insert = records.add(record);
            insert.onsuccess = () => snapshots.add(snapshot, insert.result);
          });
          temporary = undefined;
          note.textContent = "";
        } catch {
          temporary = { record: { ...record, id: null }, snapshot };
          note.textContent = "The browser could not save this run. It is available until you close or reload this page.";
        }
        await refresh();
      });
    },
  };
}
