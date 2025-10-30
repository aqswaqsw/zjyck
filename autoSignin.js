/*
cron: 0 9 * * * autoSignin.js
*/

const axios = require('axios');

// 阿里云盘API配置
const UPDATE_TOKEN_URL = 'https://auth.aliyundrive.com/v2/account/token';
const SIGNIN_URL = 'https://member.aliyundrive.com/v1/activity/sign_in_list';
const REWARD_URL = 'https://member.aliyundrive.com/v1/activity/sign_in_reward';

console.log('🚀 脚本开始执行 - 阿里云盘签到');

// 简单的通知函数（兼容青龙面板）
async function sendNotify(title, content) {
  try {
    // 尝试加载青龙的通知模块
    if (typeof require('sendNotify') !== 'undefined') {
      const notify = require('sendNotify');
      await notify.sendNotify(title, content);
    }
    console.log(`【${title}】\n${content}`);
  } catch (e) {
    console.log(`【${title}】\n${content}`);
  }
}

// 使用 refresh_token 更新 access_token
async function updateAccessToken(refreshToken, remarks) {
  try {
    console.log(`🔄 正在更新 ${remarks} 的 access_token...`);
    
    const response = await axios.post(UPDATE_TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    const { code, message, nick_name, refresh_token, access_token } = response.data;
    
    if (code) {
      throw new Error(`API返回错误: ${code} - ${message}`);
    }
    
    if (!access_token) {
      throw new Error('未能获取到access_token');
    }
    
    console.log(`✅ ${remarks} token更新成功`);
    return { 
      nick_name: nick_name || remarks, 
      refresh_token, 
      access_token 
    };
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('网络请求超时，请检查网络连接');
    }
    throw new Error(`token更新失败: ${error.message}`);
  }
}

// 执行签到
async function signIn(accessToken, remarks) {
  const messages = [`📱 ${remarks}`];
  
  try {
    console.log(`📝 正在执行 ${remarks} 的签到...`);
    
    // 获取签到信息
    const signinResponse = await axios.post(SIGNIN_URL, 
      { isReward: false },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
        },
        timeout: 10000
      }
    );
    
    const signinData = signinResponse.data;
    
    if (!signinData.success) {
      throw new Error(`签到接口返回失败: ${signinData.message || '未知错误'}`);
    }
    
    messages.push('✅ 签到成功');
    
    const { signInLogs, signInCount } = signinData.result;
    messages.push(`📅 本月累计签到 ${signInCount} 天`);
    
    // 检查今日奖励
    const todayLog = signInLogs.find(log => log.day === signInCount);
    if (todayLog && todayLog.isReward && todayLog.reward) {
      const reward = todayLog.reward;
      messages.push(`🎁 今日奖励: ${reward.name || ''}${reward.description || ''}`);
    }
    
    // 尝试领取奖励
    try {
      const rewardResponse = await axios.post(REWARD_URL,
        { signInDay: signInCount },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      const rewardData = rewardResponse.data;
      if (rewardData.success && rewardData.result) {
        messages.push(`🎯 奖励领取: ${rewardData.result.name || ''}${rewardData.result.description || ''}`);
      }
    } catch (rewardError) {
      messages.push('💡 奖励领取跳过（可能已领取）');
    }
    
    return messages.join(' | ');
  } catch (error) {
    messages.push('❌ 签到失败');
    messages.push(`错误详情: ${error.message}`);
    if (error.response) {
      messages.push(`状态码: ${error.response.status}`);
    }
    throw new Error(messages.join(' | '));
  }
}

// 获取环境变量中的refreshToken
function getRefreshTokens() {
  console.log('🔍 正在读取环境变量...');
  
  let refreshTokens = process.env.refreshToken || '';
  console.log(`找到环境变量: ${refreshTokens ? '有' : '无'}`);
  
  if (!refreshTokens) {
    console.log('❌ 错误: 未找到refreshToken环境变量');
    console.log('💡 请在青龙面板"环境变量"中添加名称: refreshToken');
    console.log('💡 值: 您的阿里云盘refresh_token');
    return [];
  }
  
  // 支持多种分隔符
  const tokens = refreshTokens.split(/[&\n]/)
    .map(token => token.trim())
    .filter(token => token && token.length > 10);
  
  console.log(`找到 ${tokens.length} 个有效token`);
  
  if (tokens.length === 0) {
    console.log('❌ 错误: 未找到有效的refreshToken');
    console.log('💡 请检查token格式，支持&或换行分隔多个账号');
  }
  
  return tokens.map((token, index) => ({
    token: token,
    remarks: `账号${index + 1}`
  }));
}

// 主函数
async function main() {
  console.log('='.repeat(50));
  console.log('🚀 阿里云盘签到脚本开始执行');
  console.log('⏰ 时间:', new Date().toLocaleString());
  console.log('='.repeat(50));
  
  const tokens = getRefreshTokens();
  
  if (tokens.length === 0) {
    await sendNotify('阿里云盘签到失败', '未配置有效的refreshToken环境变量');
    process.exit(1);
  }
  
  const results = [];
  let successCount = 0;
  
  for (const { token, remarks } of tokens) {
    try {
      console.log(`\n🔐 处理 ${remarks}...`);
      
      // 更新access_token
      const { nick_name, access_token } = await updateAccessToken(token, remarks);
      const actualRemarks = nick_name !== remarks ? `${nick_name}(${remarks})` : remarks;
      
      // 执行签到
      const result = await signIn(access_token, actualRemarks);
      console.log(`✅ ${actualRemarks} 处理成功`);
      console.log(`📋 结果: ${result}`);
      
      results.push(result);
      successCount++;
      
      // 短暂延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`❌ ${remarks} 处理失败:`, error.message);
      results.push(`${remarks}失败: ${error.message}`);
    }
  }
  
  // 发送通知
  const finalMessage = [
    `执行时间: ${new Date().toLocaleString()}`,
    `处理账号: ${tokens.length} 个`,
    `成功数量: ${successCount} 个`,
    `失败数量: ${tokens.length - successCount} 个`,
    '',
    '详细结果:',
    ...results
  ].join('\n');
  
  await sendNotify('阿里云盘签到报告', finalMessage);
  
  console.log('\n' + '='.repeat(50));
  console.log(`✅ 脚本执行完成 - 成功: ${successCount}/${tokens.length}`);
  console.log('='.repeat(50));
}

// 执行主函数
main().catch(async (error) => {
  console.error('\n💥 脚本执行出错:');
  console.error(error);
  
  await sendNotify('阿里云盘签到错误', 
    `脚本执行失败:\n${error.message}\n\n请检查脚本配置和环境变量。`
  );
  
  process.exit(1);
});
