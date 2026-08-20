# PowerShell Script to Update Options.xaml
# This script moves Configuration Control section to bottom, removes background, and changes button color

Write-Host "Updating Options.xaml..." -ForegroundColor Cyan

# Read file content
$filePath = "Options.xaml"
$content = Get-Content $filePath -Raw -Encoding UTF8

# Define the Configuration Control section to remove (with old colors)
$oldSection = @'
                <!-- Configuration Control Buttons -->
                <Border Background="#F5F5F5" Padding="10" Margin="0,0,0,15" CornerRadius="5">
                    <StackPanel>
                        <TextBlock Text="Configuration Control" FontWeight="Bold" Margin="0,0,0,10" />
                        <StackPanel Orientation="Horizontal">
                            <CheckBox Content="Modify Mode (Enable Editing)"
                                      IsChecked="{Binding IsModifyMode, Mode=TwoWay}"
                                      VerticalAlignment="Center"
                                      Margin="0,0,15,0"
                                      FontWeight="SemiBold" />
                            <Button Content="SAVE ALL SETTINGS &amp; REBOOT"
                                    Command="{Binding SaveAllSettingsCommand}"
                                    IsEnabled="{Binding IsModifyMode}"
                                    Width="220"
                                    Height="30"
                                    Background="#FF4444"
                                    Foreground="White"
                                    FontWeight="Bold" />
                        </StackPanel>
                        <TextBlock Text="⚠️ Turn on Modify Mode to edit settings. Click SAVE to apply changes and reboot device."
                                   TextWrapping="Wrap"
                                   Foreground="DarkOrange"
                                   FontSize="11"
                                   Margin="0,8,0,0" />
                    </StackPanel>
                </Border>
'@

# Define new Configuration Control section (no background, green button)
$newSection = @'
                <!-- Configuration Control Buttons -->
                <Border Padding="10" Margin="0,0,0,15" CornerRadius="5">
                    <StackPanel>
                        <TextBlock Text="Configuration Control" FontWeight="Bold" Margin="0,0,0,10" />
                        <StackPanel Orientation="Horizontal">
                            <CheckBox Content="Modify Mode (Enable Editing)"
                                      IsChecked="{Binding IsModifyMode, Mode=TwoWay}"
                                      VerticalAlignment="Center"
                                      Margin="0,0,15,0"
                                      FontWeight="SemiBold" />
                            <Button Content="SAVE ALL SETTINGS &amp; REBOOT"
                                    Command="{Binding SaveAllSettingsCommand}"
                                    IsEnabled="{Binding IsModifyMode}"
                                    Width="220"
                                    Height="30"
                                    Background="#7CFC00"
                                    Foreground="Black"
                                    FontWeight="Bold" />
                        </StackPanel>
                        <TextBlock Text="⚠️ Turn on Modify Mode to edit settings. Click SAVE to apply changes and reboot device."
                                   TextWrapping="Wrap"
                                   Foreground="DarkOrange"
                                   FontSize="11"
                                   Margin="0,8,0,0" />
                    </StackPanel>
                </Border>
'@

# Step 1: Remove old section (if exists)
if ($content -match [regex]::Escape($oldSection)) {
    Write-Host "Removing old Configuration Control section from top..." -ForegroundColor Yellow
    $content = $content.Replace($oldSection, "")
    Write-Host "Old section removed." -ForegroundColor Green
} else {
    Write-Host "Old section not found (might be already updated or modified)." -ForegroundColor Yellow
}

# Step 2: Find position to insert (before closing StackPanel)
$insertMarker = "            </StackPanel>`r`n        </ScrollViewer>"
$insertIndex = $content.IndexOf($insertMarker)

if ($insertIndex -gt 0) {
    Write-Host "Inserting new Configuration Control section at bottom..." -ForegroundColor Yellow
    
    # Insert new section before the closing tags
    $before = $content.Substring(0, $insertIndex)
    $after = $content.Substring($insertIndex)
    
    # Add new section with proper line breaks
    $content = $before + "`r`n" + $newSection + "`r`n" + $after
    
    Write-Host "New section inserted." -ForegroundColor Green
} else {
    Write-Host "ERROR: Could not find insertion point!" -ForegroundColor Red
    Write-Host "Marker not found: $insertMarker" -ForegroundColor Red
    exit 1
}

# Step 3: Save updated content
Write-Host "Saving changes..." -ForegroundColor Yellow
Set-Content -Path $filePath -Value $content -Encoding UTF8 -NoNewline

Write-Host "✓ Options.xaml updated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Changes made:" -ForegroundColor Cyan
Write-Host "  1. Moved Configuration Control section to bottom"
Write-Host "  2. Removed gray background (Background=#F5F5F5)"
Write-Host "  3. Changed button color: #FF4444 (red) → #7CFC00 (lawn green)"
Write-Host "  4. Changed button text: White → Black"
Write-Host ""
Write-Host "Next: Rebuild project and test!" -ForegroundColor Yellow
