// 测试时间解析函数
function parseChineseTime(text) {
  console.log('========== parseChineseTime 调试 ==========');
  console.log('输入文本:', text);
  
  const now = new Date();
  let daysOffset = 0;
  let hours = now.getHours();
  let minutes = now.getMinutes();
  let seconds = 0;
  
  // 解析具体日期 "X月Y日" 格式
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})日?/);
  console.log('具体日期匹配:', dateMatch);
  if (dateMatch) {
    const targetMonth = parseInt(dateMatch[1]);
    const targetDay = parseInt(dateMatch[2]);
    const currentYear = now.getFullYear();
    let targetDate = new Date(currentYear, targetMonth - 1, targetDay, 8, 0, 0);
    
    if (targetDate < now) {
      targetDate = new Date(currentYear + 1, targetMonth - 1, targetDay, 8, 0, 0);
    }
    
    const timeFullMatch = text.match(/(\d{1,2})点(\d{1,2})分?/);
    const timeSimpleMatch = text.match(/(\d{1,2})点(?!\d)/);
    
    if (timeFullMatch || timeSimpleMatch) {
      if (timeFullMatch) {
        hours = parseInt(timeFullMatch[1]);
        minutes = parseInt(timeFullMatch[2]);
      } else {
        hours = parseInt(timeSimpleMatch[1]);
        minutes = 0;
      }
      
      if (text.includes('晚上') || text.includes('夜里') || text.includes('深夜')) {
        if (hours >= 1 && hours < 12) hours += 12;
      } else if (text.includes('下午') || text.includes('午后')) {
        if (hours >= 1 && hours < 12) hours += 12;
      } else if (text.includes('早上') || text.includes('上午')) {
        if (hours >= 12) hours -= 12;
      }
      
      targetDate.setHours(hours, minutes, seconds, 0);
    }
    
    console.log('解析结果:', targetDate.toLocaleString('zh-CN'));
    return targetDate;
  }
  
  // 解析日期偏移
  const tomorrowCount = (text.match(/明天/g) || []).length;
  
  if (text.includes('大后天')) {
    daysOffset = 3;
  } else if (text.includes('后天')) {
    daysOffset = 2;
  } else if (tomorrowCount >= 2) {
    daysOffset = tomorrowCount;
  } else if (text.includes('明天')) {
    daysOffset = 1;
  }
  console.log('日期偏移:', daysOffset);
  
  // 解析时间
  const timeMatch = text.match(/(\d{1,2})点(\d{1,2})分?/);
  const hourMatch = text.match(/(\d{1,2})点/);
  
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = parseInt(timeMatch[2]);
  } else if (hourMatch) {
    hours = parseInt(hourMatch[1]);
    minutes = 0;
  }
  
  // 时段调整
  if (text.includes('晚上') || text.includes('夜里') || text.includes('深夜')) {
    if (hours >= 1 && hours < 12) hours += 12;
  } else if (text.includes('下午') || text.includes('午后')) {
    if (hours >= 1 && hours < 12) hours += 12;
  }
  
  const result = new Date();
  if (daysOffset !== 0) {
    result.setDate(result.getDate() + daysOffset);
  }
  result.setHours(hours, minutes, seconds, 0);
  
  if (daysOffset === 0 && result < now) {
    result.setDate(result.getDate() + 1);
  }
  
  console.log('解析结果:', result.toLocaleString('zh-CN'));
  return result;
}

// 测试用例
console.log('\n=== 测试时间解析 ===');
console.log('当前时间:', new Date().toLocaleString('zh-CN'));
console.log('\n1. 明天8点有个会议');
parseChineseTime('明天8点有个会议');
console.log('\n2. 后天下午3点开会');
parseChineseTime('后天下午3点开会');
console.log('\n3. 5月18日早上IT会议');
parseChineseTime('5月18日早上IT会议');
console.log('\n4. 明天的明天早上10点会议');
parseChineseTime('明天的明天早上10点会议');
