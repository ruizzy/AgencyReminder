require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');

const app = express();
const db = new Database('reminder.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    remind_time TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    pushed_at TEXT
  )
`);

const config = {
  llm_api_url: process.env.LLM_API_URL || 'https://api.siliconflow.cn/v1/chat/completions',
  llm_api_key: process.env.LLM_API_KEY || '',
  llm_model: process.env.LLM_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
  wechat_webhook_url: process.env.WECHAT_WEBHOOK_URL || '',
  check_interval: '*/1 * * * *'
};

function parseChineseTime(text) {
  console.log('========== parseChineseTime 调试 ==========');
  console.log('输入文本:', text);
  
  const now = new Date();
  let daysOffset = 0;
  let hours = now.getHours();
  let minutes = now.getMinutes();
  let seconds = 0;
  
  // 解析具体日期 "X月Y日" 格式（直接使用中文汉字）
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})日?/);
  console.log('具体日期匹配:', dateMatch);
  console.log('日期匹配类型:', dateMatch ? '成功' : '失败');
  if (dateMatch) {
    const targetMonth = parseInt(dateMatch[1]);
    const targetDay = parseInt(dateMatch[2]);
    
    const currentYear = now.getFullYear();
    // 默认设置为早上8点
    let targetDate = new Date(currentYear, targetMonth - 1, targetDay, 8, 0, 0);
    
    // 如果日期已过，设置到下一年
    if (targetDate < now) {
      targetDate = new Date(currentYear + 1, targetMonth - 1, targetDay, 8, 0, 0);
    }
    
    // 解析时间 "X点Y分" 格式
    const timeFullMatch = text.match(/(\d{1,2})点(\d{1,2})分?/);
    // 解析时间 "X点" 格式
    const timeSimpleMatch = text.match(/(\d{1,2})点(?!\d)/);
    console.log('完整时间匹配:', timeFullMatch, '简单时间匹配:', timeSimpleMatch);
    
    // 只有找到时间才更新，否则保持默认的8点
    if (timeFullMatch || timeSimpleMatch) {
      if (timeFullMatch) {
        hours = parseInt(timeFullMatch[1]);
        minutes = parseInt(timeFullMatch[2]);
      } else {
        hours = parseInt(timeSimpleMatch[1]);
        minutes = 0;
      }
      
      // 根据时段调整小时
      if (text.includes('晚上') || text.includes('夜里') || text.includes('深夜')) {
        if (hours >= 1 && hours < 12) hours += 12;
      } else if (text.includes('下午') || text.includes('午后')) {
        if (hours >= 1 && hours < 12) hours += 12;
      } else if (text.includes('早上') || text.includes('上午')) {
        if (hours >= 12) hours -= 12;
      }
      
      // 应用时间
      targetDate.setHours(hours, minutes, seconds, 0);
    }
    console.log('解析结果(具体日期):', targetDate.toISOString());
    console.log('=========================================');
    return targetDate;
  }
  
  // 解析日期偏移（支持复合表达如"明天的明天"）
  const tomorrowCount = (text.match(/明天/g) || []).length;
  const yesterdayCount = (text.match(/昨天/g) || []).length;
  
  if (text.includes('大后天')) {
    daysOffset = 3;
  } else if (text.includes('后天')) {
    daysOffset = 2;
  } else if (text.includes('前天')) {
    daysOffset = -2;
  } else if (tomorrowCount >= 2) {
    daysOffset = tomorrowCount;
  } else if (text.includes('明天')) {
    daysOffset = 1;
  } else if (yesterdayCount >= 2) {
    daysOffset = -yesterdayCount;
  } else if (text.includes('昨天')) {
    daysOffset = -1;
  }
  console.log('日期偏移:', daysOffset);
  
  // 优先匹配 "X点Y分" 格式
  const timeMatch = text.match(/(\d{1,2})[\u70B9\u7089](\d{1,2})[\u5206]?/);
  console.log('时间匹配(X点Y分):', timeMatch);
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = parseInt(timeMatch[2]);
  } else {
    // 匹配 "X点" 格式（直接使用中文点字）
    const hourMatch = text.match(/(\d{1,2})点/);
    console.log('小时匹配(X点):', hourMatch);
    if (hourMatch) {
      hours = parseInt(hourMatch[1]);
      minutes = 0;
    } else {
      // 尝试其他格式
      const hourMatch2 = text.match(/(\d{1,2})[\u70B9]/);
      console.log('小时匹配(Unicode点):', hourMatch2);
      if (hourMatch2) {
        hours = parseInt(hourMatch2[1]);
        minutes = 0;
      } else {
        // 匹配 "X分" 格式（只有分钟）
        const minuteMatch = text.match(/(\d{1,2})[\u5206]/);
        console.log('分钟匹配:', minuteMatch);
        if (minuteMatch) {
          minutes = parseInt(minuteMatch[1]);
        }
      }
    }
  }
  console.log('解析后时间: hours=', hours, 'minutes=', minutes);
  
  // 根据中文时段调整小时
  if (text.includes('晚上') || text.includes('夜里') || text.includes('深夜')) {
    if (hours >= 1 && hours < 12) {
      hours += 12;
    } else if (hours === 0) {
      hours = 24;
    }
  } else if (text.includes('下午') || text.includes('午后')) {
    if (hours >= 1 && hours < 12) {
      hours += 12;
    }
  } else if (text.includes('早上') || text.includes('上午')) {
    if (hours >= 12) {
      hours -= 12;
    }
  }
  console.log('时段调整后: hours=', hours);
  
  // 验证小时范围
  if (hours < 0 || hours > 24) {
    hours = now.getHours();
  }
  if (minutes < 0 || minutes >= 60) {
    minutes = 0;
  }
  
  const result = new Date();
  console.log('初始日期:', result.toISOString());
  
  // 应用日期偏移
  if (daysOffset !== 0) {
    result.setDate(result.getDate() + daysOffset);
    console.log('应用日期偏移后:', result.toISOString());
  }
  
  result.setHours(hours, minutes, seconds, 0);
  console.log('应用时间后:', result.toISOString());
  
  // 如果没有指定日期偏移且时间已过，设置为明天
  if (daysOffset === 0 && result < now) {
    result.setDate(result.getDate() + 1);
    console.log('时间已过，调整到明天:', result.toISOString());
  }
  
  console.log('最终结果:', result.toISOString());
  console.log('=========================================');
  return result;
}

function extractTaskInfo(text) {
  const remindTime = parseChineseTime(text);
  
  console.log('========== 后备解析结果 ==========');
  console.log('原始输入:', text);
  console.log('解析结果:', remindTime.toISOString());
  console.log('=================================');
  
  // 提取标题：移除日期时间相关的描述，保留核心任务内容
  let title = text
    .replace(/今天|明天|后天|大后天|前天|昨天/g, '')
    .replace(/早上|上午|中午|下午|晚上|夜里|深夜/g, '')
    .replace(/\d+[\点分秒]/g, (match) => match.slice(0, -1) + '点')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (title.length < 5) {
    title = text.substring(0, 30);
  }
  
  return {
    title: title.substring(0, 50),
    content: text,
    remind_time: remindTime.toISOString()
  };
}

async function callLLM(taskText) {
  if (!config.llm_api_url) {
    console.log('LLM API URL 未配置，使用默认提取');
    return extractTaskInfo(taskText);
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.llm_api_key) {
      headers['Authorization'] = `Bearer ${config.llm_api_key}`;
    }

    const requestData = {
      model: config.llm_model,
      messages: [{
        role: 'user',
        content: `请从以下文本中提取任务信息，直接返回JSON格式，不要用markdown代码块包裹。

日期时间解析规则：
1. 日期表达："今天"=今天，"明天"=明天，"后天"=后天，"大后天"=第三天，"明天的明天"=后天；
2. 时段规则："早上"=6-12点，"上午"=6-12点，"中午"=11-13点，"下午"=12-18点，"晚上"=18-24点，"夜里"=18-24点，"深夜"=22-24点；
3. 时间格式："X点Y分"如"10点30分"=10:30，"X点"如"3点"=15:00（需结合时段判断）；
4. 如果日期已过则自动调整到最近的有效日期。

格式要求：{"title":"任务标题(不超过30字)","content":"任务内容","remind_time":"提醒时间(ISO 8601格式，如果未明确指定则默认当前时间+10分钟)"}。

文本：${taskText}`
      }],
      temperature: 0.7
    };
    
    console.log('========== LLM API 请求 ==========');
    console.log('URL:', config.llm_api_url);
    console.log('Headers:', JSON.stringify(headers, null, 2));
    console.log('Request:', JSON.stringify(requestData, null, 2));

    const response = await axios.post(config.llm_api_url, requestData, { headers });

    console.log('---------- LLM API 响应 ----------');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('================================');

    let content = response.data.choices[0].message.content;
    
    // 清理 markdown 代码块
    content = content.replace(/```json|```json\s*|```/g, '').trim();
    
    // 尝试修复常见的 JSON 问题
    content = content.replace(/([{,]\s*)'(\w+)'(\s*:)/g, '$1"$2"$3'); // 单引号转双引号
    content = content.replace(/,\s*([\]}])/g, '$1'); // 移除尾部逗号
    
    let result;
    try {
      result = JSON.parse(content);
      // 始终使用原始输入作为content，不使用LLM返回的简化版本
      result.content = taskText;
    } catch (parseError) {
      console.error('JSON解析失败，尝试修复并重新解析...');
      // 如果解析失败，尝试用正则提取关键字段
      const titleMatch = content.match(/"title"\s*:\s*"([^"]+)"/);
      const timeMatch = content.match(/"remind_time"\s*:\s*"([^"]+)"/);
      
      if (titleMatch && timeMatch) {
        result = {
          title: titleMatch[1],
          content: taskText,
          remind_time: timeMatch[1]
        };
      } else {
        throw new Error('无法从响应中提取有效数据');
      }
    }
    
    // 验证并修复 remind_time 格式
    if (result.remind_time) {
      let remindTime;
      
      // 如果是纯时间格式（如 "21:08" 或 "8:00"），需要结合当前/目标日期
      if (/^\d{1,2}:\d{2}$/.test(result.remind_time)) {
        const [hours, minutes] = result.remind_time.split(':').map(Number);
        remindTime = parseChineseTime(taskText); // 使用后备解析获取正确日期
        remindTime.setHours(hours, minutes, 0, 0);
      } else {
        remindTime = new Date(result.remind_time);
      }
      
      // 验证时间是否有效
      if (isNaN(remindTime.getTime())) {
        console.warn('LLM返回的时间格式无效，使用默认解析:', result.remind_time);
        return extractTaskInfo(taskText);
      }
      
      // 如果时间在过去，调整年份到最近的有效年份
      const now = new Date();
      if (remindTime < now) {
        // 保留原始的月日时分秒，只调整年份
        const targetYear = now.getFullYear();
        const targetMonth = remindTime.getMonth();
        const targetDay = remindTime.getDate();
        const targetHours = remindTime.getHours();
        const targetMinutes = remindTime.getMinutes();
        const targetSeconds = remindTime.getSeconds();
        
        let adjustedTime = new Date(targetYear, targetMonth, targetDay, targetHours, targetMinutes, targetSeconds);
        
        // 如果调整后仍然在过去，设置到下一年
        if (adjustedTime < now) {
          adjustedTime = new Date(targetYear + 1, targetMonth, targetDay, targetHours, targetMinutes, targetSeconds);
        }
        
        result.remind_time = adjustedTime.toISOString();
      } else {
        result.remind_time = remindTime.toISOString();
      }
    } else {
      result.remind_time = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    }
    
    // 修复 content 字段
    if (!result.content || result.content.length < 5) {
      result.content = taskText;
    }
    
    return result;
  } catch (error) {
    console.error('LLM调用失败，使用默认提取:', error.message);
    return extractTaskInfo(taskText);
  }
}

async function pushToWeChat(task) {
  if (!config.wechat_webhook_url) {
    console.log('企信Webhook未配置，跳过推送');
    return false;
  }

  try {
    const requestData = {
      msgtype: 'text',
      text: {
        content: `⏰ 任务提醒\n\n📌 ${task.title}\n📝 ${task.content}\n⏱️ 提醒时间：${new Date(task.remind_time).toLocaleString('zh-CN')}`
      }
    };
    
    console.log('========== 企信推送请求 ==========');
    console.log('URL:', config.wechat_webhook_url);
    console.log('Request:', JSON.stringify(requestData, null, 2));

    const response = await axios.post(config.wechat_webhook_url, requestData);

    console.log('---------- 企信推送响应 ----------');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('=================================');
    return true;
  } catch (error) {
    console.error('========== 企信推送失败 ==========');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('================================');
    return false;
  }
}

function checkAndPushTasks() {
  const now = new Date();
  const tasks = db.prepare('SELECT * FROM tasks WHERE status = ?').all('pending');

  tasks.forEach(task => {
    const remindTime = new Date(task.remind_time);
    const diff = remindTime.getTime() - now.getTime();

    if (diff <= 10 * 60 * 1000 && diff > 0) {
      pushToWeChat(task).then(success => {
        if (success) {
          db.prepare('UPDATE tasks SET status = ?, pushed_at = ? WHERE id = ?')
            .run('completed', new Date().toISOString(), task.id);
        }
      });
    }
  });
}

cron.schedule(config.check_interval, checkAndPushTasks);

app.post('/api/tasks', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: '任务文本不能为空' });
    }

    const taskInfo = await callLLM(text);

    const stmt = db.prepare('INSERT INTO tasks (title, content, remind_time) VALUES (?, ?, ?)');
    const result = stmt.run(taskInfo.title, taskInfo.content, taskInfo.remind_time);

    res.json({
      success: true,
      data: {
        id: result.lastInsertRowid,
        ...taskInfo
      }
    });
  } catch (error) {
    console.error('创建任务失败:', error);
    res.status(500).json({ error: '创建任务失败' });
  }
});

app.get('/api/tasks', (req, res) => {
  try {
    const { status } = req.query;
    let tasks;
    if (status) {
      tasks = db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY remind_time DESC').all(status);
    } else {
      tasks = db.prepare('SELECT * FROM tasks ORDER BY remind_time DESC').all();
    }
    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('获取任务失败:', error);
    res.status(500).json({ error: '获取任务失败' });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('删除任务失败:', error);
    res.status(500).json({ error: '删除任务失败' });
  }
});

app.post('/api/tasks/:id/push', async (req, res) => {
  try {
    const { id } = req.params;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    const success = await pushToWeChat(task);
    if (success) {
      db.prepare('UPDATE tasks SET status = ?, pushed_at = ? WHERE id = ?')
        .run('completed', new Date().toISOString(), id);
      res.json({ success: true });
    } else {
      res.status(500).json({ error: '推送失败，请检查企信Webhook配置' });
    }
  } catch (error) {
    console.error('推送任务失败:', error);
    res.status(500).json({ error: '推送任务失败' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    has_llm_key: !!config.llm_api_key,
    has_wechat_webhook: !!config.wechat_webhook_url
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 任务提醒服务已启动: http://localhost:${PORT}`);
});