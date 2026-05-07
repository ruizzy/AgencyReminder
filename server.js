require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const port = process.env.PORT || 3001;

// 数据存储文件路径
const DATA_FILE = 'reminder.json';

// 内存数据缓存
let tasks = [];
let nextId = 1;

// 初始化数据存储
async function initDataStore() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(data);
    tasks = parsed.tasks || [];
    nextId = parsed.nextId || 1;
    console.log('数据加载成功，共 ' + tasks.length + ' 条记录');
  } catch (err) {
    console.log('数据文件不存在，创建新存储');
    tasks = [];
    nextId = 1;
    await saveData();
  }
}

// 保存数据到文件
async function saveData() {
  await fs.writeFile(DATA_FILE, JSON.stringify({ tasks, nextId }, null, 2));
}

// 模拟数据库操作
const db = {
  all: async function(sql, params, callback) {
    try {
      let results = [...tasks];
      
      // 解析简单的 SQL 查询
      if (sql.includes('WHERE status = "pending"')) {
        results = results.filter(t => t.status === 'pending');
      } else if (sql.includes('WHERE status = "pushed"')) {
        results = results.filter(t => t.status === 'pushed');
      }
      
      if (sql.includes('ORDER BY remind_time ASC')) {
        results.sort((a, b) => new Date(a.remind_time) - new Date(b.remind_time));
      } else if (sql.includes('ORDER BY pushed_at DESC')) {
        results.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
      } else if (sql.includes('ORDER BY status ASC')) {
        results.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
      }
      
      callback(null, results);
    } catch (err) {
      callback(err, null);
    }
  },
  
  get: async function(sql, params, callback) {
    try {
      const id = params[0];
      const task = tasks.find(t => t.id === parseInt(id));
      callback(null, task);
    } catch (err) {
      callback(err, null);
    }
  },
  
  run: async function(sql, params, callback) {
    try {
      if (sql.includes('INSERT INTO tasks')) {
        const [title, content, remind_time] = params;
        const newTask = {
          id: nextId++,
          title,
          content,
          remind_time,
          status: 'pending',
          created_at: new Date().toISOString(),
          pushed_at: null
        };
        tasks.push(newTask);
        await saveData();
        callback(null, { lastID: newTask.id });
      } else if (sql.includes('UPDATE tasks SET status = "pushed"')) {
        const id = params[0];
        const task = tasks.find(t => t.id === parseInt(id));
        if (task) {
          task.status = 'pushed';
          task.pushed_at = new Date().toISOString();
          await saveData();
        }
        callback(null);
      } else if (sql.includes('DELETE FROM tasks')) {
        const id = params[0];
        const initialLength = tasks.length;
        tasks = tasks.filter(t => t.id !== parseInt(id));
        await saveData();
        callback(null, { changes: initialLength - tasks.length });
      } else {
        callback(null);
      }
    } catch (err) {
      callback(err);
    }
  }
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})日?/);
  console.log('具体日期匹配:', dateMatch);
  console.log('日期匹配类型:', dateMatch ? '成功' : '失败');
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
    console.log('完整时间匹配:', timeFullMatch, '简单时间匹配:', timeSimpleMatch);
    
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
    
    console.log('解析结果(具体日期):', targetDate.toISOString());
    console.log('=========================================');
    return targetDate;
  }
  
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
  
  const timeMatch = text.match(/(\d{1,2})[\u70B9\u7089](\d{1,2})[\u5206]?/);
  console.log('时间匹配(X点Y分):', timeMatch);
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = parseInt(timeMatch[2]);
  } else {
    const hourMatch = text.match(/(\d{1,2})点/);
    console.log('小时匹配(X点):', hourMatch);
    if (hourMatch) {
      hours = parseInt(hourMatch[1]);
      minutes = 0;
    } else {
      const hourMatch2 = text.match(/(\d{1,2})[\u70B9]/);
      console.log('小时匹配(Unicode点):', hourMatch2);
      if (hourMatch2) {
        hours = parseInt(hourMatch2[1]);
        minutes = 0;
      } else {
        const minuteMatch = text.match(/(\d{1,2})[\u5206]/);
        console.log('分钟匹配:', minuteMatch);
        if (minuteMatch) {
          minutes = parseInt(minuteMatch[1]);
        }
      }
    }
  }
  
  if (text.includes('晚上') || text.includes('夜里') || text.includes('深夜')) {
    if (hours >= 1 && hours < 12) hours += 12;
  } else if (text.includes('下午') || text.includes('午后')) {
    if (hours >= 1 && hours < 12) hours += 12;
  } else if (text.includes('早上') || text.includes('上午')) {
    if (hours >= 12) hours -= 12;
  }
  
  const result = new Date();
  console.log('初始日期:', result.toISOString());
  
  if (daysOffset !== 0) {
    result.setDate(result.getDate() + daysOffset);
    console.log('应用日期偏移后:', result.toISOString());
  }
  
  result.setHours(hours, minutes, seconds, 0);
  console.log('应用时间后:', result.toISOString());
  
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
  if (!config.llm_api_key) {
    console.log('LLM API URL 未配置，使用默认提取');
    return extractTaskInfo(taskText);
  }
  
  try {
    console.log('========== LLM API 请求 ==========');
    console.log('URL:', config.llm_api_url);
    console.log('Headers:', {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.llm_api_key.slice(0, 10) + '...'
    });
    
    const requestData = {
      model: config.llm_model,
      messages: [{
        role: 'user',
        content: `请从以下文本中提取任务信息，直接返回JSON格式，不要用markdown代码块包裹。\n\n日期时间解析规则：\n1. 日期表达："今天"=今天，"明天"=明天，"后天"=后天，"大后天"=第三天，"明天的明天"=后天；\n2. 时段规则："早上"=6-12点，"上午"=6-12点，"中午"=11-13点，"下午"=12-18点，"晚上"=18-24点，"夜里"=18-24点，"深夜"=22-24点；\n3. 时间格式："X点Y分"如"10点30分"=10:30，"X点"如"3点"=15:00（需结合时段判断）；\n4. 如果日期已过则自动调整到最近的有效日期。\n\n格式要求：{"title":"任务标题(不超过30字)","content":"任务内容","remind_time":"提醒时间(ISO 8601格式，如果未明确指定则默认当前时间+10分钟)"}。\n\n文本：${taskText}`
      }],
      temperature: 0.7
    };
    
    console.log('Request:', JSON.stringify(requestData, null, 2).slice(0, 500) + '...');
    
    const response = await axios.post(config.llm_api_url, requestData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.llm_api_key
      }
    });
    
    console.log('---------- LLM API 响应 ----------');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('================================');
    
    let content = response.data.choices[0].message.content;
    
    content = content.replace(/```json|```json\s*|```/g, '').trim();
    content = content.replace(/([{,]\s*)'(\w+)'(\s*:)/g, '$1"$2"$3');
    content = content.replace(/,\s*([\]}])/g, '$1');
    
    let result;
    try {
      result = JSON.parse(content);
      result.content = taskText;
    } catch (parseError) {
      console.error('JSON解析失败，尝试修复并重新解析...');
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
    
    if (result.remind_time) {
      let remindTime;
      const now = new Date();
      
      if (/^\d{1,2}:\d{2}$/.test(result.remind_time)) {
        const [hours, minutes] = result.remind_time.split(':').map(Number);
        remindTime = parseChineseTime(taskText);
        remindTime.setHours(hours, minutes, 0, 0);
      } else {
        remindTime = new Date(result.remind_time);
        
        if (isNaN(remindTime.getTime())) {
          console.warn('LLM返回的时间格式无效，使用默认解析:', result.remind_time);
          return extractTaskInfo(taskText);
        }
        
        const localDate = parseChineseTime(taskText);
        const llmHours = remindTime.getHours();
        const llmMinutes = remindTime.getMinutes();
        const llmSeconds = remindTime.getSeconds();
        
        remindTime = new Date(
          localDate.getFullYear(),
          localDate.getMonth(),
          localDate.getDate(),
          llmHours,
          llmMinutes,
          llmSeconds
        );
      }
      
      if (isNaN(remindTime.getTime())) {
        console.warn('最终时间解析失败，使用默认解析');
        return extractTaskInfo(taskText);
      }
      
      if (remindTime < now) {
        remindTime.setDate(remindTime.getDate() + 1);
      }
      
      result.remind_time = remindTime.toISOString();
    } else {
      result.remind_time = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    }
    
    return result;
  } catch (error) {
    console.error('LLM调用失败，使用默认提取:', error.message);
    return extractTaskInfo(taskText);
  }
}

app.get('/api/config', (req, res) => {
  res.json({
    has_llm_key: !!config.llm_api_key,
    has_wechat_webhook: !!config.wechat_webhook_url
  });
});

app.get('/api/tasks', (req, res) => {
  const status = req.query.status;
  
  let sql;
  if (status === 'pending') {
    sql = 'SELECT * FROM tasks WHERE status = "pending" ORDER BY remind_time ASC';
  } else if (status === 'completed') {
    sql = 'SELECT * FROM tasks WHERE status = "pushed" ORDER BY pushed_at DESC';
  } else {
    sql = 'SELECT * FROM tasks ORDER BY status ASC, remind_time ASC';
  }
  
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, data: rows });
  });
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { text, content } = req.body;
    const taskText = text || content;
    const taskInfo = await callLLM(taskText);
    
    db.run(
      'INSERT INTO tasks (title, content, remind_time) VALUES (?, ?, ?)',
      [taskInfo.title, taskInfo.content, taskInfo.remind_time],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, id: tasks.find(t => t.title === taskInfo.title)?.id || nextId - 1, ...taskInfo });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tasks/pending', (req, res) => {
  db.all('SELECT * FROM tasks WHERE status = "pending" ORDER BY remind_time ASC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.get('/api/tasks/pushed', (req, res) => {
  db.all('SELECT * FROM tasks WHERE status = "pushed" ORDER BY pushed_at DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.run('DELETE FROM tasks WHERE id = ?', [req.params.id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ deleted: tasks.filter(t => t.id === parseInt(req.params.id)).length === 0 });
  });
});

app.post('/api/tasks/:id/push', (req, res) => {
  db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id], async (err, task) => {
    if (err || !task) {
      return res.status(404).json({ error: '任务不存在' });
    }
    
    try {
      await sendWechatMessage(task);
      db.run('UPDATE tasks SET status = "pushed", pushed_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

async function sendWechatMessage(task) {
  const webhookUrl = config.wechat_webhook_url;
  if (!webhookUrl) {
    console.log('企信Webhook未配置，跳过推送');
    return;
  }
  
  const message = {
    msgtype: 'text',
    text: {
      content: `⏰ 任务提醒\n\n📌 ${task.title}\n📝 ${task.content}\n⏱ 提醒时间：${formatTime(task.remind_time)}`
    }
  };
  
  try {
    console.log('========== 企信推送请求 ==========');
    console.log('URL:', webhookUrl);
    console.log('Request:', JSON.stringify(message));
    
    const response = await axios.post(webhookUrl, message);
    
    console.log('---------- 企信推送响应 ----------');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data));
    console.log('=================================');
  } catch (error) {
    console.error('========== 企信推送失败 ==========');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data));
    }
    console.log('=================================');
    throw error;
  }
}

function formatTime(timeStr) {
  const date = new Date(timeStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

cron.schedule(config.check_interval, () => {
  const now = new Date();
  
  db.all('SELECT * FROM tasks WHERE status = "pending"', [], (err, pendingTasks) => {
    if (err) return;
    
    pendingTasks.forEach(task => {
      const taskTime = new Date(task.remind_time);
      const pushTime = new Date(taskTime.getTime() - 10 * 60 * 1000);
      
      if (pushTime <= now && pushTime > new Date(now.getTime() - 60 * 1000)) {
        sendWechatMessage(task).then(() => {
          db.run('UPDATE tasks SET status = "pushed", pushed_at = CURRENT_TIMESTAMP WHERE id = ?', [task.id]);
        }).catch(console.error);
      }
    });
  });
});

// 启动时初始化数据存储
initDataStore().then(() => {
  app.listen(port, () => {
    console.log(`服务运行在 http://localhost:${port}`);
  });
});