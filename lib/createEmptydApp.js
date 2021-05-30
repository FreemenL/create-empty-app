'use strict';
// 验证包名 
const validateProjectName = require('validate-npm-package-name');
const chalk = require('chalk');
const commander = require('commander');
const fs = require('fs-extra');
const path = require('path');
const execSync = require('child_process').execSync;
// 跨平台开启子进程
const spawn = require('cross-spawn');
const semver = require('semver');
const dns = require('dns');
// 临时文件系统 
const tmp = require('tmp');
// 压缩解压
const unpack = require('tar-pack').unpack;
const url = require('url');
// 发送http请求
const hyperquest = require('hyperquest');
// 输出环境变量
const envinfo = require('envinfo');
const os = require('os');

const packageJson = require('../package.json');

// These files should be allowed to remain on a failed install,
// but then silently removed during the next create.
const errorLogFilePatterns = [
    'npm-debug.log',
    'yarn-error.log',
    'yarn-debug.log',
];

let projectName;
 
const program = new commander.Command(packageJson.name)
  .version(packageJson.version) // 设置版本号
  .arguments('<project-directory>') //获取输入参数
  .usage(`${chalk.green('<project-directory>')} [options]`)  // --help 时候输出的用例提示
  .action(name => {  //此处的name 就对应.arguments('<project-directory>') 中的参数
    projectName = name;
  })
  .option('--verbose', 'print additional logs')  //打印额外的日志
  .option('--info', 'print environment debug info') //打印系统信息
  .option(
    '--scripts-version <alternative-package>',
    'use a non-standard version of react-scripts'
  ) //使用非标准版本的 react-scripts 
  .option('--use-npm') //使用npm 
  .option('--use-pnp') 
  .option('--typescript')
  .allowUnknownOption()
  .on('--help', () => {
    console.log(`Only ${chalk.green('<project-directory>')} is required.`);
    console.log();
    console.log(
      `    A custom ${chalk.cyan('--scripts-version')} can be one of:`
    );
    console.log(`- a specific npm version: ${chalk.green('0.8.2')}`);
    console.log(`- a specific npm tag: ${chalk.green('@next')}`);
    console.log(
      ` - a custom fork published on npm: ${chalk.green(
        'my-react-scripts'
      )}`
    );
    console.log(
      `- a local path relative to the current working directory: ${chalk.green(
        'file:../my-react-scripts'
      )}`
    );
    console.log(
      `- a .tgz archive: ${chalk.green(
        'https://mysite.com/my-react-scripts-0.8.2.tgz'
      )}`
    );
    console.log(
      `      - a .tar.gz archive: ${chalk.green(
        'https://mysite.com/my-react-scripts-0.8.2.tar.gz'
      )}`
    );
    console.log(
      `    It is not needed unless you specifically want to use a fork.`
    );
    console.log();
    console.log(
      `    If you have any problems, do not hesitate to file an issue:`
    );
    console.log(
      `      ${chalk.cyan(
        'https://github.com/facebook/create-react-app/issues/new'
      )}`
    );
    console.log();
  })
  .parse(process.argv);

  // create-empty-app --info 输出 操作系统等环境信息
  if(program.info){
    console.log(chalk.bold('\nEnvironment Info:'));
    return envinfo
      .run(
        {
          System: ['OS', 'CPU'],
          Binaries: ['Node', 'npm', 'Yarn'],
          Browsers: ['Chrome', 'Edge', 'Internet Explorer', 'Firefox', 'Safari'],
          npmPackages: ['react', 'react-dom', 'react-scripts'],
          npmGlobalPackages: ['create-react-app'],
        },
        {
          clipboard: false,
          duplicates: true,
          showNotFound: true,
        }
      )
      .then(function(params){
        console.log(chalk.blue(params));
      });
  }

  if (typeof projectName === 'undefined') {
    console.error('Please specify the project directory:');
    console.log(
      `  ${chalk.cyan(program.name())} ${chalk.green('<project-directory>')}`
    );
    console.log();
    console.log('For example:');
    console.log(`  ${chalk.cyan(program.name())} ${chalk.green('my-app')}`);
    console.log();
    console.log(
      `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
    );
    process.exit(1);
  }

// 使用内部测试版本
  const hiddenProgram = new commander.Command()
  .option(
    '--internal-testing-template <path-to-template>',
    '(internal usage only, DO NOT RELY ON THIS) ' +
      'use a non-standard application template'
  )
  .parse(process.argv);

createApp(
    projectName, 
    program.verbose,
    program.scriptsVersion,
    program.useNpm,
    program.usePnp,
    program.typescript,
    hiddenProgram.internalTestingTemplate
);
// 输出验证包名的错误提示 
function printValidationResults(results) {
    if (typeof results !== 'undefined') {
      results.forEach(error => {
        console.error(chalk.red(`  *  ${error}`));
      });
    }
}
// 命名规范
function checkAppName(appName) {
    //验证包的命名规则是否合理
    const validationResult = validateProjectName(appName);
    if (!validationResult.validForNewPackages) {
      console.error(
        `Could not create a project called ${chalk.red(
          `"${appName}"`
        )} because of npm naming restrictions:`
      );
      printValidationResults(validationResult.errors);
      printValidationResults(validationResult.warnings);
      process.exit(1); //失败方式结束进程
    }
  
    //  项目名称不能包含一下关键字数组中的元素
    const dependencies = ['react', 'react-dom','emptyd'].sort();
    if (dependencies.indexOf(appName) >= 0) {
      console.error(
        chalk.red(
          `We cannot create a project called ${chalk.green(
            appName
          )} because a dependency with the same name exists.\n` +
            `Due to the way npm works, the following names are not allowed:\n\n`
        ) +
          chalk.cyan(dependencies.map(depName => `  ${depName}`).join('\n')) +
          chalk.red('\n\nPlease choose a different project name.')
      );
      process.exit(1); //失败方式结束进程
    }
}  

// 检测项目目录中的杂质 和 删除遗留文件
function isSafeToCreateProjectIn(root, name) {
    const validFiles = [
      '.DS_Store',
      'Thumbs.db',
      '.git',
      '.gitignore',
      '.idea',
      'README.md',
      'LICENSE',
      '.hg',
      '.hgignore',
      '.hgcheck',
      '.npmignore',
      'mkdocs.yml',
      'docs',
      '.travis.yml',
      '.gitlab-ci.yml',
      '.gitattributes',
    ];
    console.log();
  
    const conflicts = fs
      .readdirSync(root) // 获取当前文件目录下的文件列表
      .filter(file => !validFiles.includes(file))   // 排除 validFiles 中的元素
      // IntelliJ IDEA creates module files before CRA is launched
      .filter(file => !/\.iml$/.test(file))  // 排除以.iml 结尾的文件
      // Don't treat log files from previous installation as conflicts
      .filter( // 排除 errorLogFilePatterns 中的文件
        file => !errorLogFilePatterns.some(pattern => file.indexOf(pattern) === 0)
      );
    // 保证项目目录里面除了 validFiles 中的元素，以.iml 结尾的文件，errorLogFilePatterns 中的文件 以外不包含任何杂质
    if (conflicts.length > 0) {
      console.log(
        `The directory ${chalk.green(name)} contains files that could conflict:`
      );
      console.log();
      for (const file of conflicts) {
        console.log(`  ${chalk.red(file)}`);
      }
      console.log();
      console.log(
        'Either try using a new directory name, or remove the files listed above.'
      );
      return false;
    }
  
    // 删除项目目录中的错误日志及调试日志文件 errorLogFilePatterns    
    const currentFiles = fs.readdirSync(path.join(root));
    currentFiles.forEach(file => {
      errorLogFilePatterns.forEach(errorLogFilePattern => {
        if (file.indexOf(errorLogFilePattern) === 0) {
          fs.removeSync(path.join(root, file));
        }
      });
    });
  
    return true;
}
// 检测有无安装yarn 
function shouldUseYarn() {
    try {
      execSync('yarnpkg --version', { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
}
//  判断命令行中cwd  和当前进程中的cwd 是否一致
function checkThatNpmCanReadCwd() {
    const cwd = process.cwd();
    let childOutput = null;
    try {
      // Note: intentionally using spawn over exec since
      // the problem doesn't reproduce otherwise.
      // `npm config list` is the only reliable way I could find
      // to reproduce the wrong path. Just printing process.cwd()
      // in a Node process was not enough.
      // 检测环境中有无安装npm 
      childOutput = spawn.sync('npm', ['config', 'list']).output.join('');
    } catch (err) {
      // Something went wrong spawning node.
      // Not great, but it means we can't do this check.
      // We might fail later on, but let's continue.
      return true;
    }
    // 检测环境中有无安装npm 
    if (typeof childOutput !== 'string') {
      return true;
    }
    const lines = childOutput.split('\n');
    // `npm config list` output includes the following line:
    // "; cwd = C:\path\to\current\dir" (unquoted)
    // I couldn't find an easier way to get it.
    const prefix = '; cwd = ';
    const line = lines.find(line => line.indexOf(prefix) === 0);

    if (typeof line !== 'string') {
      // Fail gracefully. They could remove it.
      return true;
    }
    const npmCWD = line.substring(prefix.length);

    if (npmCWD === cwd) {
      return true;
    }
    console.error(
      chalk.red(
        `Could not start an npm process in the right directory.\n\n` +
          `The current directory is: ${chalk.bold(cwd)}\n` +
          `However, a newly started npm process runs in: ${chalk.bold(
            npmCWD
          )}\n\n` +
          `This is probably caused by a misconfigured system terminal shell.`
      )
    );
    console.log(process.platform);
    if (process.platform === 'win32') {
      console.error(
        chalk.red(`On Windows, this can usually be fixed by running:\n\n`) +
          `  ${chalk.cyan(
            'reg'
          )} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
          `  ${chalk.cyan(
            'reg'
          )} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
          chalk.red(`Try to run the above two lines in the terminal.\n`) +
          chalk.red(
            `To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
          )
      );
    }
    return false;
}
// 检测npm 的版本是否大于3.0.0
function checkNpmVersion() {
    let hasMinNpm = false;
    let npmVersion = null;
    try {
      npmVersion = execSync('npm --version')
        .toString()
        .trim();
      hasMinNpm = semver.gte(npmVersion, '3.0.0');
    } catch (err) {
      // ignore
    }
    return {
      hasMinNpm: hasMinNpm,
      npmVersion: npmVersion,
    };
}
// 检测yarn 的版本是否大于3.0.0
function checkYarnVersion() {
    let hasMinYarnPnp = false;
    let yarnVersion = null;
    try {
      yarnVersion = execSync('yarnpkg --version')
        .toString()
        .trim();
      let trimmedYarnVersion = /^(.+?)[-+].+$/.exec(yarnVersion);
      if (trimmedYarnVersion) {
        trimmedYarnVersion = trimmedYarnVersion.pop();
      }
      hasMinYarnPnp = semver.gte(trimmedYarnVersion || yarnVersion, '1.12.0');
    } catch (err) {
      // ignore
    }
    return {
      hasMinYarnPnp: hasMinYarnPnp,
      yarnVersion: yarnVersion,
    };
}
// 创建临时的空目录用于解压文件
function getTemporaryDirectory() {
  return new Promise((resolve, reject) => {
    // Unsafe cleanup lets us recursively delete the directory if it contains
    // contents; by default it only allows removal if it's empty
    tmp.dir({ unsafeCleanup: true }, (err, tmpdir, callback) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          tmpdir: tmpdir,
          cleanup: () => {
            try {
              callback();
            } catch (ignored) {
              // Callback might throw and fail, since it's a temp directory the
              // OS will clean it up eventually...
            }
          },
        });
      }
    });
  });
}
// 流的方式解压文件
function extractStream(stream, dest) {
  return new Promise((resolve, reject) => {
    stream.pipe(
      unpack(dest, err => {
        if (err) {
          reject(err);
        } else {
          resolve(dest);
        }
      })
    );
  });
}

// 从压缩文件或者路径中解析 提取PackageName
function getPackageName(installPackage) {
  // 如果 react-scripts 是压缩文件 就请求回来解压 然后拿到文件的 packageName
  if (installPackage.match(/^.+\.(tgz|tar\.gz)$/)) {
    return getTemporaryDirectory()
      .then(obj => {
        let stream;
        if (/^http/.test(installPackage)) {
          stream = hyperquest(installPackage);
        } else {
          stream = fs.createReadStream(installPackage);
        }
        return extractStream(stream, obj.tmpdir).then(() => obj);
      })
      .then(obj => {
        const packageName = require(path.join(obj.tmpdir, 'package.json')).name;
        obj.cleanup();
        return packageName;
      })
      .catch(err => {
        // The package name could be with or without semver version, e.g. react-scripts-0.2.0-alpha.1.tgz
        // However, this function returns package name only without semver version.
        console.log(
          `Could not extract the package name from the archive: ${err.message}`
        );
        const assumedProjectName = installPackage.match(
          /^.+\/(.+?)(?:-\d+.+)?\.(tgz|tar\.gz)$/
        )[1];
        console.log(
          `Based on the filename, assuming it is "${chalk.cyan(
            assumedProjectName
          )}"`
        );
        return Promise.resolve(assumedProjectName);
      });
   } else if (installPackage.indexOf('git+') === 0) {
    // 如果依赖的名称是git地址 就匹配 .git 前的名称
    return Promise.resolve(installPackage.match(/([^/]+)\.git(#.*)?$/)[1]);
  } else if (installPackage.match(/.+@/)) {
    // Do not match @scope/ when stripping off @version or @tag
    return Promise.resolve(
      installPackage.charAt(0) + installPackage.substr(1).split('@')[0]
    );
  } else if (installPackage.match(/^file:/)) {
    const installPackagePath = installPackage.match(/^file:(.*)?$/)[1];
    const installPackageJson = require(path.join(
      installPackagePath,
      'package.json'
    ));
    return Promise.resolve(installPackageJson.name);
  }
  return Promise.resolve(installPackage);
}

function getProxy() {
  if (process.env.https_proxy) {
    return process.env.https_proxy;
  } else {
    try {
      // Trying to read https-proxy from .npmrc
      let httpsProxy = execSync('npm config get https-proxy')
        .toString()
        .trim();
      return httpsProxy !== 'null' ? httpsProxy : undefined;
    } catch (e) {
      return;
    }
  }
}

function checkIfOnline(useYarn) {
  if (!useYarn) {
    // Don't ping the Yarn registry.
    // We'll just assume the best case.
    return Promise.resolve(true);
  }

  return new Promise(resolve => {
    dns.lookup('registry.yarnpkg.com', err => {
      let proxy;
      if (err != null && (proxy = getProxy())) {
        // If a proxy is defined, we likely can't resolve external hostnames.
        // Try to resolve the proxy name as an indication of a connection.
        dns.lookup(url.parse(proxy).hostname, proxyErr => {
          resolve(proxyErr == null);
        });
      } else {
        resolve(err == null);
      }
    });
  });
}


// 检测 node 的版本是否符合当前的需求 
function checkNodeVersion() {
  const packageJsonPath = path.resolve(
    './package.json'
  );
  // 如果不存在 ./package.json
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  const packageJson = require(packageJsonPath);
  if (!packageJson.engines || !packageJson.engines.node) {
    return;
  }

  if (!semver.satisfies(process.version, packageJson.engines.node)) {
    console.error(
      chalk.red(
        'You are running Node %s.\n' +
          'Create emptyd App requires Node %s or higher. \n' +
          'Please update your version of Node.'
      ),
      process.version,
      packageJson.engines.node
    );
    process.exit(1);
  }
}
// 下载基础依赖
function install(root, useYarn, usePnp, dependencies, verbose, isOnline) {
  return new Promise((resolve, reject) => {
    let command;
    let args;
    if (useYarn) {
      command = 'yarnpkg';
      args = ['add', '--exact']; // 精确下载依赖
      if (!isOnline) {
        // 从离线镜像中获取依赖
        args.push('--offline');
      }
      if (usePnp) {
        args.push('--enable-pnp');
      }
      // args [ 'add', '--exact', 'react', 'react-dom', 'react-scripts' ]
      [].push.apply(args, dependencies);
      
      // Explicitly set cwd() to work around issues like
      // https://github.com/facebook/create-react-app/issues/3326.
      // Unfortunately we can only do this for Yarn because npm support for
      // equivalent --prefix flag doesn't help with this issue.
      // This is why for npm, we run checkThatNpmCanReadCwd() early instead.
      args.push('--cwd');
      args.push(root);
      //  [ 'add',
      //  '--exact',
      //  'react',
      //  'react-dom',
      //  'react-scripts',
      //  '--cwd',
      //  '/Users/jiayali/Desktop/emptyd/create-empty-app/test/insert' ]
      if (!isOnline) {
        console.log(chalk.yellow('You appear to be offline.'));
        console.log(chalk.yellow('Falling back to the local Yarn cache.'));
        console.log();
      }
    } else {
      command = 'npm';
      args = [
        'install',
        '--save',
        '--save-exact',
        '--loglevel',
        'error',
      ].concat(dependencies);

      if (usePnp) {
        console.log(chalk.yellow("NPM doesn't support PnP."));
        console.log(chalk.yellow('Falling back to the regular installs.'));
        console.log();
      }
    }
    if (verbose) {
      args.push('--verbose');
    }

    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `${command} ${args.join(' ')}`,
        });
        return;
      }
      resolve();
    });
  });
}

// 版本纠正
function setCaretRangeForRuntimeDeps() {
  const packagePath = path.join(process.cwd(), 'package.json');
  const packageJson = require(packagePath);

  if (typeof packageJson.dependencies === 'undefined') {
    console.error(chalk.red('Missing dependencies in package.json'));
    process.exit(1);
  }

  makeCaretRange(packageJson.dependencies, 'react');
  makeCaretRange(packageJson.dependencies, 'react-dom');
  
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + os.EOL);
}
// 检测基础依赖的版本号
function makeCaretRange(dependencies, name) {
  const version = dependencies[name];

  if (typeof version === 'undefined') {
    console.error(chalk.red(`Missing ${name} dependency in package.json`));
    process.exit(1);
  }

  let patchedVersion = `${version}`;
  if (!semver.validRange(patchedVersion)) {
    console.error(
      `Unable to patch ${name} dependency version because version ${chalk.red(
        version
      )} will become invalid ${chalk.red(patchedVersion)}`
    );
    patchedVersion = version;
  }
  dependencies[name] = patchedVersion;
}

function executeNodeScript({ cwd, args }, data, source) {
  return new Promise((resolve, reject) => {
    //此处的意思就是 开启一个子进程 执行 传进来的 source 代码 也就是 react-scripts/scripts/init.js
    //把 data 序列化后作为参数 传给react-scripts/scripts/init.js 中导出的函数
    const child = spawn(
      process.execPath,
      [...args, '-e', source, '--', JSON.stringify(data)],
      { cwd, stdio: 'inherit' }
    );

    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `node ${args.join(' ')}`,
        });
        return;
      }
      resolve();
    });
  });
}
// 执行
function createApp(
    name,            // 项目名称
    verbose,         // 打印额外的日志信息
    version,         // 使用非标准版本的 react-scripts  
    useNpm,          // 使用npm
    usePnp,          // 使用pnp
    useTypescript,   // 使用typescript 
    template         // 使用内测版本的模版文件
  ) {
    const root = path.resolve(name);  // 获取项目的绝对路径
    const appName = path.basename(root);   // 获取项目名称
    
    checkAppName(appName);  // 验证项目名称
    fs.ensureDirSync(name);  // 确保项目目录存在。如果目录结构不存在，则创建它
    // 如果项目文件中有杂质 就结束当前进程
    if (!isSafeToCreateProjectIn(root, name)) {
      process.exit(1);
    }
    console.log(`Creating a new emptyd app in ${chalk.green(root)}.`);
    console.log();
  
    const packageJson = {
      name: appName,
      version: '0.1.0',
      private: true,
    };
    //写入 package.json 文件  os.EOL:兼容各操作系统的换行符 
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(packageJson, null, 2) + os.EOL
    );

    // JSON.stringify({ x: [10, undefined, function(){}, Symbol('')] }); 
    // '{"x":[10,null,null,null]}' 

    // JSON.stringify(packageJson, function(key, value) {
    //     if (typeof value === 'string') {
    //       return undefined;
    //     }
    //     return value;
    //   }, 2)

    const useYarn = useNpm ? false : shouldUseYarn();
    const originalDirectory = process.cwd();
    process.chdir(root);
    //  如果不使用yarn的方式 并且命令行中cwd 和当前进程中的cwd 不一致的话 结束当前进程
    if (!useYarn && !checkThatNpmCanReadCwd()) {
      process.exit(1);
    }
    // node 低于6.0的话使用react-scripts@0.9.x
    if (!semver.satisfies(process.version, '>=6.0.0')) {
      console.log(
        chalk.yellow(
          `You are using Node ${
            process.version
          } so the project will be bootstrapped with an old unsupported version of tools.\n\n` +
            `Please update to Node 6 or higher for a better, fully supported experience.\n`
        )
      );
      // Fall back to latest supported react-scripts on Node 4
      version = 'react-scripts@0.9.x';   //
    }
    // 如果不用yarn  npm的版本要大于3.0 否则 使用react-scripts@0.9.x
    if (!useYarn) {
      const npmInfo = checkNpmVersion();
      if (!npmInfo.hasMinNpm) {
        if (npmInfo.npmVersion) {
          console.log(
            chalk.yellow(
              `You are using npm ${
                npmInfo.npmVersion
              } so the project will be bootstrapped with an old unsupported version of tools.\n\n` +
                `Please update to npm 3 or higher for a better, fully supported experience.\n`
            )
          );
        }
        // Fall back to latest supported react-scripts for npm 3
        version = 'react-scripts@0.9.x';
      }
    } else if (usePnp) {
      const yarnInfo = checkYarnVersion();
      if (!yarnInfo.hasMinYarnPnp) {
        if (yarnInfo.yarnVersion) {
          chalk.yellow(
            `You are using Yarn ${
              yarnInfo.yarnVersion
            } together with the --use-pnp flag, but Plug'n'Play is only supported starting from the 1.12 release.\n\n` +
              `Please update to Yarn 1.12 or higher for a better, fully supported experience.\n`
          );
        }
        // 1.11 had an issue with webpack-dev-middleware, so better not use PnP with it (never reached stable, but still)
        usePnp = false;
      }
    }
    // 如果使用 yarn 就把lock 文件添加到 应用目录中
    if (useYarn) {
      let yarnUsesDefaultRegistry = true;
      try {
        yarnUsesDefaultRegistry =
          execSync('yarnpkg config get registry')
            .toString()
            .trim() === 'https://registry.yarnpkg.com';
      } catch (e) {
        // ignore
      }
      if (yarnUsesDefaultRegistry) {
        fs.copySync(
          require.resolve('../yarn.lock.cached'),
          path.join(root, 'yarn.lock')
        );
      }
    }
  
    run(
      root, 
      appName, 
      version,  
      verbose,
      originalDirectory,
      template,
      useYarn,
      usePnp,
      useTypescript
    );
  }
  
  function run(
    root,       // 项目的绝对路径
    appName,    // 项目名称
    version,  // 使用非标准版本的 react-scripts
    verbose,  // 打印额外的日志信息
    originalDirectory,  //脚手架命令行所在工作目录
    template,  // 使用内测版本的模版文件
    useYarn,    //使用yarn 
    usePnp,      //使用pnp
    useTypescript   //使用 typescript 
  ) {
    // 所有初始依赖
    const allDependencies = ['react', 'react-dom'];
    // 使用typescript
    if (useTypescript) {
      // TODO: get user's node version instead of installing latest
      allDependencies.push(
        '@types/node',
        '@types/react',
        '@types/react-dom',
        '@types/jest',
        'typescript'
      );
    }
  
    console.log(`${chalk.blue('Installing packages. This might take a couple of minutes...')}`);
    //从压缩文件或者路径中解析 提取PackageName
    new Promise(function(resolve){
      resolve()
    })
      .then(() => // 检测yarn 的源是否存在问题
        checkIfOnline(useYarn).then(isOnline => ({
          isOnline: isOnline,
        }))
      )
      .then(info => {
        const isOnline = info.isOnline;
        console.log(
          `Installing ${chalk.cyan('react')}, ${chalk.cyan(
            'react-dom'
          )}...`
        );
        console.log();
        return install(
          root,
          useYarn,
          usePnp,
          allDependencies,
          verbose,
          isOnline
        ) // 下载基本的依赖
      })
      .then(async () => {
        checkNodeVersion(); // 检测 node 的版本是否符合当前的要求
        setCaretRangeForRuntimeDeps();
  
        const pnpPath = path.resolve(process.cwd(), '.pnp.js');
        const nodeArgs = fs.existsSync(pnpPath) ? ['--require', pnpPath] : []; 
        // 拉取项目模版文件
        await executeNodeScript(
          {
            cwd: __dirname,
            args: nodeArgs,
          },
          [root, appName, verbose, originalDirectory, template],
          `
           var init = require('./init.js');
           init.apply(null, JSON.parse(process.argv[1]));
          `
        );
  
        if (version === 'react-scripts@0.9.x') {
          console.log(
            chalk.yellow(
              `\nNote: the project was bootstrapped with an old unsupported version of tools.\n` +
                `Please update to Node >=6 and npm >=3 to get supported tools in new projects.\n`
            )
          );
        }
      })
      .catch(reason => {
        console.log();
        console.log('Aborting installation.');
        if (reason.command) {
          console.log(`  ${chalk.cyan(reason.command)} has failed.`);
        } else {
          console.log(chalk.red('Unexpected error. Please report it as a bug:'));
          console.log(reason);
        }
        console.log();
  
        // On 'exit' we will delete these files from target directory.
        const knownGeneratedFiles = ['package.json', 'yarn.lock', 'node_modules'];
        const currentFiles = fs.readdirSync(path.join(root));
        currentFiles.forEach(file => {
          knownGeneratedFiles.forEach(fileToMatch => {
            // This removes all knownGeneratedFiles.
            if (file === fileToMatch) {
              console.log(`Deleting generated file... ${chalk.cyan(file)}`);
              fs.removeSync(path.join(root, file));
            }
          });
        });
        const remainingFiles = fs.readdirSync(path.join(root));
        if (!remainingFiles.length) {
          // Delete target folder if empty
          console.log(
            `Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
              path.resolve(root, '..')
            )}`
          );
          process.chdir(path.resolve(root, '..'));
          fs.removeSync(path.join(root));
        }
        console.log('Done.');
        process.exit(1);
      });
  }
  