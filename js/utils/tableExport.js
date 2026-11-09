// Shared Excel/CSV export helpers -- same XLSX CDN global eventsPage.js's
// own "export-csv" action already uses (window.XLSX, loaded via
// index.html's <script> tag), factored out here once the Member
// Directory became the second surface needing it (a third -- Exit
// Tracking's export list -- is coming in Feature 3).
export function exportRowsToExcel(rows, filenameBase) {
  if (!rows || rows.length === 0) return;
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  window.XLSX.writeFile(wb, `${filenameBase}.xlsx`);
}

export function exportRowsToCsv(rows, filenameBase) {
  if (!rows || rows.length === 0) return;
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const csv = window.XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.download = `${filenameBase}.csv`;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
