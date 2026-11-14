import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GB,
  buildDailySeries,
  formatMonth,
  formatMonthTitle,
  formatSize,
  monthInfo,
  percent,
  percentLabel,
  projectMonthUsage,
} from "../../src/lib/turnStats.js";

// Caracterização: fixa o que o painel "Servidor de voz" mostra hoje. Os esperados são
// literais de propósito; se algum mudar, o comportamento do painel mudou.

const MB = 1024 ** 2;

test("GB é 1024³ bytes", () => {
  assert.equal(GB, 1073741824);
});

test("formatSize: vazio vira 0 MB", () => {
  assert.equal(formatSize(0), "0 MB");
  assert.equal(formatSize(undefined), "0 MB");
  assert.equal(formatSize(null), "0 MB");
});

test("formatSize: abaixo de 1 GB sai em MB, com uma casa até 10 MB e piso de 0,1", () => {
  assert.equal(formatSize(1), "0,1 MB");
  assert.equal(formatSize(5 * MB), "5,0 MB");
  assert.equal(formatSize(10 * MB), "10 MB");
  assert.equal(formatSize(840 * MB), "840 MB");
});

test("formatSize: a partir de 1 GB sai em GB, com duas casas até 100 GB", () => {
  assert.equal(formatSize(GB), "1,00 GB");
  assert.equal(formatSize(1.24 * GB), "1,24 GB");
  assert.equal(formatSize(100 * GB), "100 GB");
  assert.equal(formatSize(312 * GB), "312 GB");
});

test("percent: arredonda, não limita a 100 e devolve 0 sem total", () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(2, 3), 67);
  assert.equal(percent(5, 0), 0);
  assert.equal(percent(150, 100), 150);
});

test("percentLabel: <1% quando há consumo que arredonda para zero", () => {
  assert.equal(percentLabel(12, 100), "12%");
  assert.equal(percentLabel(0, 100), "0%");
  assert.equal(percentLabel(1, 1000), "<1%");
  assert.equal(percentLabel(5, 0), "<1%");
  assert.equal(percentLabel(0, 0), "0%");
});

test("formatMonth e formatMonthTitle: mês por extenso em pt-BR", () => {
  assert.equal(formatMonth("2026-10"), "outubro de 2026");
  assert.equal(formatMonthTitle("2026-10"), "Outubro de 2026");
});

test("monthInfo: ano, número do mês e quantidade de dias", () => {
  assert.deepEqual(monthInfo("2026-11"), { year: 2026, monthNumber: 11, daysInMonth: 30 });
  assert.deepEqual(monthInfo("2026-02"), { year: 2026, monthNumber: 2, daysInMonth: 28 });
  assert.deepEqual(monthInfo("2028-02"), { year: 2028, monthNumber: 2, daysInMonth: 29 });
  assert.deepEqual(monthInfo("2026-12"), { year: 2026, monthNumber: 12, daysInMonth: 31 });
});

test("projectMonthUsage: ritmo dos dias decorridos projetado para o mês inteiro", () => {
  assert.equal(projectMonthUsage(300, "2026-11", new Date("2026-11-16T00:00:00Z")), 600);
  assert.equal(projectMonthUsage(100, "2026-11", new Date("2026-11-01T12:00:00Z")), 6000);
});

test("projectMonthUsage: piso de 0,25 dia no começo do mês", () => {
  assert.equal(projectMonthUsage(100, "2026-11", new Date("2026-11-01T00:00:00Z")), 12000);
});

test("projectMonthUsage: ignora os segundos e conta em UTC", () => {
  assert.equal(projectMonthUsage(300, "2026-11", new Date("2026-11-16T00:00:59Z")), 600);
  assert.equal(projectMonthUsage(300, "2026-11", new Date("2026-11-15T21:00:00-03:00")), 600);
});

test("projectMonthUsage: sem consumo a projeção é zero", () => {
  assert.equal(projectMonthUsage(0, "2026-11", new Date("2026-11-16T00:00:00Z")), 0);
});

test("buildDailySeries: um item por dia, com o maior entre app e Cloudflare", () => {
  const series = buildDailySeries(
    "2026-11",
    { "2026-11-03": 100, "2026-11-14": 7 },
    { "2026-11-03": 250, "2026-11-04": 10 },
    new Date("2026-11-14T10:00:00Z"),
  );
  assert.equal(series.length, 30);
  assert.deepEqual(series[0], { day: 1, key: "2026-11-01", appBytes: 0, cfBytes: 0, bytes: 0, future: false });
  assert.deepEqual(series[2], { day: 3, key: "2026-11-03", appBytes: 100, cfBytes: 250, bytes: 250, future: false });
  assert.deepEqual(series[3], { day: 4, key: "2026-11-04", appBytes: 0, cfBytes: 10, bytes: 10, future: false });
  // Hoje não é futuro; amanhã é.
  assert.deepEqual(series[13], { day: 14, key: "2026-11-14", appBytes: 7, cfBytes: 0, bytes: 7, future: false });
  assert.deepEqual(series[14], { day: 15, key: "2026-11-15", appBytes: 0, cfBytes: 0, bytes: 0, future: true });
  assert.deepEqual(series[29], { day: 30, key: "2026-11-30", appBytes: 0, cfBytes: 0, bytes: 0, future: true });
});

test("buildDailySeries: sem número oficial, cfBytes é 0 e bytes é o do app", () => {
  const series = buildDailySeries(
    "2026-11",
    { "2026-11-03": 100, "2026-11-14": 7 },
    null,
    new Date("2026-11-14T10:00:00Z"),
  );
  assert.equal(series.length, 30);
  for (const item of series) {
    assert.equal(item.cfBytes, 0);
    assert.equal(item.bytes, item.appBytes);
  }
  assert.deepEqual(series[2], { day: 3, key: "2026-11-03", appBytes: 100, cfBytes: 0, bytes: 100, future: false });
  assert.deepEqual(series[13], { day: 14, key: "2026-11-14", appBytes: 7, cfBytes: 0, bytes: 7, future: false });
});

test("buildDailySeries: fevereiro de 2026 tem 28 itens", () => {
  const series = buildDailySeries("2026-02", {}, null, new Date("2026-02-10T00:00:00Z"));
  assert.equal(series.length, 28);
  assert.deepEqual(series[27], { day: 28, key: "2026-02-28", appBytes: 0, cfBytes: 0, bytes: 0, future: true });
});
