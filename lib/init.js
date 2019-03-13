// @remove-file-on-eject
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', err => {
  throw err;
});
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const execSync = require('child_process').execSync;
const spawn = require('cross-spawn');
const os = require('os');
const inquirer = require('inquirer');

function isInGitRepository() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function isInMercurialRepository() {
  try {
    execSync('hg --cwd . root', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function tryGitInit(appPath) {
  let didInit = false;
  try {
    execSync('git --version', { stdio: 'ignore' });
    if (isInGitRepository() || isInMercurialRepository()) {
      return false;
    }

    execSync('git init', { stdio: 'ignore' });
    didInit = true;

    execSync('git add -A', { stdio: 'ignore' });
    execSync('git commit -m "Initial commit from Create Emptyd App"', {
      stdio: 'ignore',
    });
    return true;
  } catch (e) {
    if (didInit) {
      // If we successfully initialized but couldn't commit,
      // maybe the commit author config is not set.
      // In the future, we might supply our own committer
      // like Ember CLI does, but for now, let's just
      // remove the Git files to avoid a half-done state.
      try {
        // unlinkSync() doesn't work on directories.
        fs.removeSync(path.join(appPath, '.git'));
      } catch (removeErr) {
        // Ignore.
      }
    }
    return false;
  }
}

// 配置 package.json
function writePackage(appPath,appPackage,terminal){
  if(terminal=="h5"){
    return false;
  }
  const precommitMsg = "precommit-msg";
  appPackage["repository"]={
    "type": "git",
    "url": "github.com/freemenL/emptyd-webpack-admin"
  }
  appPackage["keywords"]=[
    "empty-design"
  ];
  appPackage["author"]= "freemenL" ;
  appPackage["license"] = "ISC" ;
  appPackage["sideEffects"] = [
    "./node_modules/free-validator/index.js"
  ]
  appPackage.scripts = {
    start: "ts-node -P config/tsconfig-for-webpack-config.json scripts/start.ts",
    build: "ts-node -P config/tsconfig-for-webpack-config.json scripts/build.ts",
    ls: "http-server dist",
    upload: "gulp",
    lint: "eslint src --ext .tsx",
    [precommitMsg]: "echo 'Pre-commit checks...' && exit 0"
  };

  // Setup the eslint config
  appPackage["pre-commit"] = [
    "precommit-msg",
    "lint"
  ];
  // Setup the browsers list
  appPackage.browserslist = [
    "chrome >= 20",
    "Firefox >= 20",
    "ios>3",
    "Android >= 3.2",
    "maintained node versions"
  ];
    // Install additional template dependencies, if present
  const templateDependenciesPath = path.join(
      appPath,
      '.template.dependencies.json'
    );
    if (fs.existsSync(templateDependenciesPath)) {
      const targetDependencies = require(templateDependenciesPath);
      const templateDependencies = targetDependencies.dependencies;
      const templateDevDependencies = targetDependencies.devDependencies;
      Object.keys(templateDependencies).forEach(key => {
        if(!appPackage.dependencies[key]){
          appPackage.dependencies[key] = templateDependencies[key];
        }
      });
      Object.keys(templateDevDependencies).forEach(key => {
         appPackage.devDependencies[key] = templateDevDependencies[key];
      })
      fs.unlinkSync(templateDependenciesPath);
  }
  //配置并写入package.json
  console.log("package");
  fs.writeFileSync(
    path.join(appPath, 'package.json'),
    JSON.stringify(appPackage, null, 2) + os.EOL
  );
}
// 下载依赖
function InstallDependencies(resolve,reject,appPath){
  process.chdir(appPath);
  const command = 'cnpm';
  let args = ['i'];
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('close', code => {
      if (code !== 0) {
        reject("Please check the network or install cnpm！")
        return;
      }
      resolve("installSuccess");
  });
}

function inquirerPack({name,message,choices,callback}){
  inquirer
    .prompt({
      type: 'list',
      name,
      message,
      choices
    })
    .then(callback);
}
//询问是否下载依赖
function askInstall(resolve,reject,appPath) {
  inquirerPack({
    name: 'result',
    message: 'Whether to download dependencies?',
    choices: ['yes', 'no'],
    callback:function(answers){
      if(answers.result=="yes"){
          InstallDependencies(resolve,reject,appPath);
      }else{
          resolve("normal");
      }
    }
  })
}

// 是否启动项目
function askRunProject(callback){
  inquirerPack({
    name: 'result',
    message: 'Help you start the project?',
    choices: ['yes', 'no'],
    callback:function(answers){
      if( answers.result == "yes" ){
        const child = spawn("npm", ["start"], { stdio: 'inherit' });
        child.on('close', code => {
            if (code !== 0) {
              console.log("start error!");
              return;
            }
            process.exit(1);
        });
        return false;
      }
      callback();
    }
  })
}

function copyAction(ownPath,appPath,terminal,appPackage){
  return new Promise(function(resolve,reject){
      console.log('Webside template initialization...');
      const templatePath = path.join(ownPath,terminal);
      if (fs.existsSync(templatePath)) {
          fs.copySync(templatePath, appPath);
          writePackage(appPath,appPackage,terminal);
          resolve("success");
      } else {
          console.error(
              `Could not locate supplied template: ${chalk.green(templatePath)}`
          );
          reject();
      }
  })
}

function copyTemplateAndInstall(ownPath,appPath,appPackage) {
  return new Promise(function(resolve,reject){
      console.log('Project template generation...');
      inquirerPack({
        name: 'terminal',
        message: 'target terminal?',
        choices: ['web', 'h5'],
        callback:function(answers){
          copyAction(ownPath,appPath,answers.terminal,appPackage).then(function(result){
              if(result==="success"){
                  askInstall(resolve,reject,appPath);
              }else{
                  resolve("normal");
              }
          }).catch(function(error){
            console.log(error);
            resolve("normal");
          })
        }
      })
  })
}
module.exports = function(
  appPath,   // 创建应用程序的主路径
  appName,   // 应用名称
  verbose,   // 打额外的日志信息 
  originalDirectory, //脚手架命令行所在工作目录
  template   // 使用内测版本的模版文件
) {
  // 获取 react-script 绝对路径
  const ownPath = path.dirname(
    require.resolve(path.join(__dirname, '.', 'package.json'))
  );
  // 目标程序的package.json 
  const appPackage = require(path.join(appPath, 'package.json'));
  // 检测目标程序是否存在yarn.lock
  const useYarn = fs.existsSync(path.join(appPath, 'yarn.lock'));

  // // Copy over some of the devDependencies
  appPackage.dependencies = appPackage.dependencies || {};
  appPackage.devDependencies = appPackage.devDependencies || {};

  const useTypeScript = appPackage.dependencies['typescript'] != null;

  const readmeExists = fs.existsSync(path.join(appPath, 'README.md'));
  if (readmeExists){
    fs.renameSync(
      path.join(appPath, 'README.md'),
      path.join(appPath, 'README.old.md')
    );
  }

  //为用户拷贝文件 
  copyTemplateAndInstall(ownPath,appPath,appPackage)
    .then(function(response){
        const callback = () =>{
            // Rename gitignore after the fact to prevent npm from renaming it to .npmignore
            // See: https://github.com/npm/npm/issues/1862
            try {
              fs.moveSync(
                path.join(appPath, 'gitignore'),
                path.join(appPath, '.gitignore'),
                []
              );
            } catch (err) {
              // Append if there's already a `.gitignore` file there
              if (err.code === 'EEXIST') {
                const data = fs.readFileSync(path.join(appPath, 'gitignore'));
                fs.appendFileSync(path.join(appPath, '.gitignore'), data);
                fs.unlinkSync(path.join(appPath, 'gitignore'));
              } else {
                throw err;
              }
            }
            // 初始化 git
            if (tryGitInit(appPath)) {
              console.log();
              console.log('Initialized a git repository.');
            }

            // Display the most elegant way to cd.
            // This needs to handle an undefined originalDirectory for
            // backward compatibility with old global-cli's.
            let cdpath;
            if (originalDirectory && path.join(originalDirectory, appName) === appPath) {
              cdpath = appName;
            } else {
              cdpath = appPath;
            }

            // Change displayed command to yarn instead of yarnpkg
            console.log(`Success! Created ${appName} at ${appPath}`);
            console.log('Inside that directory, you can run several commands:');
            console.log();
            console.log(`We have already switched the working directory to you at ${appPath}`);
            console.log(`You can run the following command`);
            console.log();
            console.log(chalk.cyan(`npm start`));
            console.log('    Starts the development server.');
            console.log();
            console.log(
              chalk.cyan(`npm run build`)
            );
            console.log('    Bundles the app into static files for production.');
            console.log();
            console.log(chalk.cyan(`npm run  ls`));
            console.log('After compiling, start a static resource service on the local port 8080.');
            console.log();
            console.log(
              chalk.cyan(`npm run upload`)
            );
            console.log(
              'Upload static resources to the server'
            );
            console.log();
            console.log(chalk.cyan(`npm run  lint`));
            console.log('Check code specification...');
            console.log();
            console.log('Happy hacking!');
        }
        if("installSuccess"==response){
          return askRunProject(callback)
        };
        callback();
    })
    .catch(function(error){
      console.log(chalk.red(error));
    })
};

