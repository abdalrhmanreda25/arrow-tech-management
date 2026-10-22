import { toCsv, type CsvColumn } from '@domain/csv'

/** Builds a CSV in the browser and downloads it. No data leaves the page. */
export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  // The BOM makes Excel read the file as UTF-8 (Arabic names, emoji).
  const blob = new Blob(['﻿', toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
