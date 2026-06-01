$files = Get-ChildItem -Path C:\com\Unified\SaasWeb\apps\platform\src -Recurse -Filter *.tsx

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    
    # If the file contains dark theme classes, replace them
    if ($content -match 'bg-slate-8' -or $content -match 'bg-slate-9' -or $content -match 'text-white' -or $content -match 'text-slate-3' -or $content -match 'text-slate-4' -or $content -match 'border-slate-7' -or $content -match 'border-slate-8') {
        
        $newContent = $content -replace 'bg-slate-900/60', 'bg-white'
        $newContent = $newContent -replace 'bg-slate-900/40', 'bg-white'
        $newContent = $newContent -replace 'bg-slate-900', 'bg-white'
        $newContent = $newContent -replace 'bg-slate-800/60', 'bg-white'
        $newContent = $newContent -replace 'bg-slate-800/40', 'bg-white'
        $newContent = $newContent -replace 'bg-slate-800', 'bg-white'
        $newContent = $newContent -replace 'bg-slate-700/50', 'bg-[#F1F5F9]'
        $newContent = $newContent -replace 'bg-slate-700', 'bg-[#F1F5F9]'
        
        $newContent = $newContent -replace 'border-slate-800/60', 'border-[#E2E8F0]'
        $newContent = $newContent -replace 'border-slate-800', 'border-[#E2E8F0]'
        $newContent = $newContent -replace 'border-slate-700/50', 'border-[#E2E8F0]'
        $newContent = $newContent -replace 'border-slate-700', 'border-[#E2E8F0]'
        
        $newContent = $newContent -replace 'text-slate-300', 'text-[#334155]'
        $newContent = $newContent -replace 'text-slate-400', 'text-[#64748B]'
        $newContent = $newContent -replace 'text-slate-500', 'text-[#64748B]'
        $newContent = $newContent -replace 'hover:bg-slate-800', 'hover:bg-[#F1F5F9]'
        $newContent = $newContent -replace 'hover:bg-white/\[0.02\]', 'hover:bg-[#F8FAFC]'
        $newContent = $newContent -replace 'text-indigo-400', 'text-[#0F6E56]'
        $newContent = $newContent -replace 'text-indigo-300', 'text-[#0F6E56]'
        $newContent = $newContent -replace 'bg-indigo-500/10', 'bg-[#0F6E56]/10'
        
        if ($file.Name -ne 'PlatformShell.tsx' -and $file.Name -ne 'Dashboard.tsx' -and $file.Name -ne 'ReportsIndex.tsx' -and $file.Name -ne 'HrmsDashboard.tsx' -and $file.Name -ne 'LoginPage.tsx' -and $file.Name -ne 'StatCard.tsx') {
            $newContent = $newContent -replace 'text-white', 'text-[#0F172A]'
            Set-Content -Path $file.FullName -Value $newContent -NoNewline
        }
    }
}
