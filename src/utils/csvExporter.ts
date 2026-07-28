import { format } from 'date-fns';

export const exportToCSV = (
  dailyData: { date: string; enter: number; exit: number }[],
  hourlyData: { hour: string; enter: number; exit: number }[]
) => {
  let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
  
  // Daily data section
  csvContent += '--- 日別集計 ---\n';
  csvContent += '日付,入山者数,下山者数,合計\n';
  dailyData.forEach(row => {
    const total = row.enter + row.exit;
    csvContent += `${row.date},${row.enter},${row.exit},${total}\n`;
  });

  csvContent += '\n--- 時間帯別集計 ---\n';
  csvContent += '時間帯,入山者数,下山者数,合計\n';
  hourlyData.forEach(row => {
    const total = row.enter + row.exit;
    csvContent += `${row.hour},${row.enter},${row.exit},${total}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `hiker_counter_export_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
