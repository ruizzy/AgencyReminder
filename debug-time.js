console.log('=== 时间调试信息 ===');
console.log('当前服务器时间:', new Date().toISOString());
console.log('当前本地时间:', new Date().toLocaleString('zh-CN'));

// 测试 ISO 字符串解析
const testISO = '2023-10-07T06:26:00.000Z';
console.log('\n测试 ISO 字符串:', testISO);
console.log('解析结果:', new Date(testISO).toLocaleString('zh-CN'));
console.log('解析时间戳:', new Date(testISO).getTime());

// 测试默认时间生成
const defaultTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
console.log('\n默认提醒时间:', defaultTime);
console.log('默认时间本地显示:', new Date(defaultTime).toLocaleString('zh-CN'));