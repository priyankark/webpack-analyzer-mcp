#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Execute a command and print the output
 * @param {string} command - Command to execute
 * @param {boolean} printOutput - Whether to print the output
 * @returns {string} - Command output
 */
function exec(command, printOutput = true) {
  try {
    const output = execSync(command, { cwd: rootDir, encoding: 'utf8' });
    if (printOutput) {
      console.log(output);
    }
    return output;
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.stdout || error.message);
    process.exit(1);
  }
}

/**
 * Get the current version from package.json
 * @returns {string} - Current version
 */
function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  return packageJson.version;
}

/**
 * Prompt the user for input
 * @param {string} question - Question to ask
 * @returns {Promise<string>} - User input
 */
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Main release function
 */
async function release() {
  console.log('🚀 Starting release process for webpack-analyzer-mcp...');
  
  // Check if working directory is clean
  try {
    execSync('git diff-index --quiet HEAD --', { cwd: rootDir });
  } catch (error) {
    const answer = await prompt('⚠️ You have uncommitted changes. Continue anyway? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      console.log('Release cancelled.');
      rl.close();
      return;
    }
  }
  
  // Build the project
  console.log('\n📦 Building the project...');
  exec('npm run build');
  
  // Make the main file executable
  console.log('\n🔧 Making the main file executable...');
  fs.chmodSync(path.join(rootDir, 'build', 'index.js'), '755');
  
  // Get current version
  const currentVersion = getCurrentVersion();
  console.log(`\nCurrent version: ${currentVersion}`);
  
  // Ask for version bump type
  console.log('\nWhat kind of release would you like to make?');
  console.log('1) Patch (1.0.0 -> 1.0.1) - Bug fixes');
  console.log('2) Minor (1.0.0 -> 1.1.0) - New features, backwards compatible');
  console.log('3) Major (1.0.0 -> 2.0.0) - Breaking changes');
  console.log('4) Custom version');
  console.log('5) Skip version bump');
  
  const versionType = await prompt('\nEnter your choice (1-5): ');
  
  let newVersion = currentVersion;
  
  if (versionType === '1') {
    exec('npm version patch --no-git-tag-version', false);
    newVersion = getCurrentVersion();
  } else if (versionType === '2') {
    exec('npm version minor --no-git-tag-version', false);
    newVersion = getCurrentVersion();
  } else if (versionType === '3') {
    exec('npm version major --no-git-tag-version', false);
    newVersion = getCurrentVersion();
  } else if (versionType === '4') {
    newVersion = await prompt(`Enter custom version (current: ${currentVersion}): `);
    exec(`npm version ${newVersion} --no-git-tag-version`, false);
  } else if (versionType === '5') {
    console.log('Skipping version bump.');
  } else {
    console.log('Invalid choice. Exiting.');
    rl.close();
    return;
  }
  
  if (versionType !== '5') {
    console.log(`\n📝 Version bumped to ${newVersion}`);
  }
  
  // Ask for npm publish
  const publishAnswer = await prompt('\nDo you want to publish to npm? (y/N): ');
  
  if (publishAnswer.toLowerCase() === 'y') {
    console.log('\n🚀 Publishing to npm...');
    exec('npm publish');
    console.log(`\n✅ Successfully published version ${newVersion} to npm!`);
    
    // Ask for git commit and tag
    const gitAnswer = await prompt('\nDo you want to commit and create a git tag? (y/N): ');
    
    if (gitAnswer.toLowerCase() === 'y') {
      console.log('\n📝 Committing changes...');
      exec(`git add package.json package-lock.json`);
      exec(`git commit -m "Release v${newVersion}"`);
      exec(`git tag v${newVersion}`);
      
      // Ask for git push
      const pushAnswer = await prompt('\nDo you want to push to remote repository? (y/N): ');
      
      if (pushAnswer.toLowerCase() === 'y') {
        console.log('\n🚀 Pushing to remote...');
        exec('git push');
        exec('git push --tags');
        console.log('\n✅ Successfully pushed to remote!');
      }
    }
  }
  
  console.log('\n✨ Release process completed!');
  rl.close();
}

// Run the release function
release().catch((error) => {
  console.error('Error during release:', error);
  rl.close();
  process.exit(1);
});
