#!/usr/bin/env python3
import json
import re
import os
import sys

def update_version():
    package_json_path = 'package.json'
    build_gradle_path = 'android/app/build.gradle'
    pbxproj_path = 'ios/FlashDrop.xcodeproj/project.pbxproj'

    # 1. Read and update version in package.json
    with open(package_json_path, 'r') as f:
        package_obj = json.load(f)
    
    current_version = package_obj.get('version', '0.0.0')
    major, minor, patch = map(int, current_version.split('.'))
    new_patch = patch + 1
    new_version_name = f"{major}.{minor}.{new_patch}"
    
    package_obj['version'] = new_version_name
    with open(package_json_path, 'w') as f:
        json.dump(package_obj, f, indent=2)
        f.write('\n')
    print(f"✅ package.json: {current_version} -> {new_version_name}")

    # 2. Update Android: versionCode and versionName
    if os.path.exists(build_gradle_path):
        with open(build_gradle_path, 'r') as f:
            content = f.read()
        
        # Increment versionCode
        vc_match = re.search(r'versionCode (\d+)', content)
        if vc_match:
            new_vc = int(vc_match.group(1)) + 1
            content = re.sub(r'versionCode \d+', f'versionCode {new_vc}', content)
            print(f"✅ Android versionCode: {new_vc}")

        # Update versionName
        content = re.sub(r'versionName ".*?"', f'versionName "{new_version_name}"', content)
        with open(build_gradle_path, 'w') as f:
            f.write(content)
        print(f"✅ Android versionName: {new_version_name}")

    # 3. Update iOS: CURRENT_PROJECT_VERSION and MARKETING_VERSION
    if os.path.exists(pbxproj_path):
        with open(pbxproj_path, 'r') as f:
            content = f.read()
        
        # Increment CURRENT_PROJECT_VERSION (build number)
        cpv_matches = re.findall(r'CURRENT_PROJECT_VERSION = (\d+);', content)
        if cpv_matches:
            # We take the first one found or max
            new_build = int(cpv_matches[0]) + 1
            content = re.sub(r'CURRENT_PROJECT_VERSION = \d+;', f'CURRENT_PROJECT_VERSION = {new_build};', content)
            print(f"✅ iOS CURRENT_PROJECT_VERSION: {new_build}")

        # Update MARKETING_VERSION
        content = re.sub(r'MARKETING_VERSION = .*?;', f'MARKETING_VERSION = {new_version_name};', content)
        
        with open(pbxproj_path, 'w') as f:
            f.write(content)
        print(f"✅ iOS MARKETING_VERSION: {new_version_name}")

if __name__ == '__main__':
    update_version()
